/*
 * MateCheck - the computer opponent
 * Copyright (c) 2026 Swayam Shakya
 * Released under the MIT License
 *
 * Negamax with alpha-beta, iterative deepening, a transposition table,
 * killer/history ordering and a short quiescence search over banishing moves.
 *
 * Inside the tree it uses its own pseudo-legal generator: a move is tried,
 * thrown away if it leaves our king hanging, and a position where the side to
 * move is in check with no way out is treated as the result of an illegal
 * (cornering) move. The root always uses the engine's full legal list, so the
 * computer never actually plays anything the rules forbid.
 *
 * The evaluation asks one question: how close is each army to standing home?
 * Weights live in assets/js/weights.js and come out of the self-play tuning
 * in MateCheck.ipynb.
 *
 * The factory must stay self-contained - the worker rebuilds it from source.
 */
(function (root, factory) {
  'use strict';
  var api = { factory: factory };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MateCheckBrain = api;
}(typeof self !== 'undefined' ? self : this, function buildMateCheckBrain(E, weights) {
  'use strict';

  var WHITE = E.WHITE, BLACK = E.BLACK;
  var PAWN = E.PAWN, KNIGHT = E.KNIGHT, BISHOP = E.BISHOP, ROOK = E.ROOK, QUEEN = E.QUEEN, KING = E.KING;
  var RECALL = E.RECALL, PASS = E.PASS;
  var HOME_W = E.HOME_W, HOME_B = E.HOME_B;
  var KNIGHT_T = E.KNIGHT_T, KING_T = E.KING_T, RAYS = E.RAYS;

  var DEFAULTS = {
    work: 30,          // value of one move of progress
    queen: 160,        // having the queen on the board (best fighter, best rallier)
    muster: 8,         // a piece on the muster ground that can still raise a comrade
    royalEarly: 0.35,  // how much the royals' walk home counts before the army is in
    squatted: 1,       // extra moves needed when an enemy sits on a free home square
    noRallier: 2,      // extra moves when the reserve is full but nobody can raise it
    check: 8,
    tempo: 10,
    courtIdle: 1.5     // a royal idling in its own court while comrades still wait
  };
  var W = {};
  function setWeights(w) {
    var k;
    for (k in DEFAULTS) W[k] = DEFAULTS[k];
    if (w) for (k in w) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) W[k] = w[k];
  }
  setWeights(weights);

  var WIN = 100000;
  var WIN_BOUND = WIN - 1000;
  var DAWN_WIN = 50000;
  var INF = 1000000;
  var CAP = 16;                         // "this piece will never get home"

  function isLight(s) { return ((s & 7) + (s >> 3)) & 1; }

  // ---- path maps --------------------------------------------------------------------
  // For a side and a pattern of its sealed pieces ("walls") we build, per piece
  // type, a map of how many moves a piece on any square still needs to reach a
  // free home square of its kind, walking around the walls. Sealed pieces never
  // move again, so walls only grow and the cache stays tiny over a game.
  var SEAL_SQS = { 1: [], '-1': [] };
  for (var s0 = 0; s0 < 64; s0++) {
    if (HOME_W[s0] && HOME_W[s0] < QUEEN) SEAL_SQS[1].push(s0);
    if (HOME_B[s0] && HOME_B[s0] < QUEEN) SEAL_SQS[-1].push(s0);
  }
  var MUSTER = { 1: [], '-1': [] };
  for (s0 = 0; s0 < 64; s0++) {
    if (E.inMuster(WHITE, s0)) MUSTER[1].push(s0);
    if (E.inMuster(BLACK, s0)) MUSTER[-1].push(s0);
  }
  var mapCache = { 1: new Map(), '-1': new Map() };

  function wallKey(b, color) {
    var list = SEAL_SQS[color], home = color === WHITE ? HOME_W : HOME_B, key = 0;
    for (var i = 0; i < list.length; i++) if (b[list[i]] === color * home[list[i]]) key |= 1 << i;
    return key;
  }

  function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }

  function buildMaps(color, key) {
    var home = color === WHITE ? HOME_W : HOME_B, list = SEAL_SQS[color];
    var wall = new Uint8Array(64), i, s, t;
    for (i = 0; i < list.length; i++) if (key & (1 << i)) wall[list[i]] = 1;
    var maps = [null];
    for (t = PAWN; t <= KING; t++) {
      var dist = new Int8Array(64).fill(CAP), queue = [], head = 0;
      for (s = 0; s < 64; s++) if (home[s] === t && !wall[s]) { dist[s] = 0; queue.push(s); }
      while (head < queue.length) {
        var c = queue[head++], nd = dist[c] + 1, k, n, ray;
        if (nd >= CAP) continue;
        switch (t) {
          case PAWN: {
            // walk the pawn's (backward) moves in reverse: who could step onto c?
            var f = c & 7, r = c >> 3, fwd = color === WHITE ? 8 : -8, preds = [];
            if (r + fwd / 8 >= 1 && r + fwd / 8 <= 6) {
              preds.push(c + fwd);
              if (f > 0) preds.push(c + fwd - 1);
              if (f < 7) preds.push(c + fwd + 1);
              // reverse double step: home rank pawn square reached from two ranks away
              if ((color === WHITE && r === 1) || (color === BLACK && r === 6)) {
                if (!wall[c + fwd]) preds.push(c + 2 * fwd);
              }
            }
            for (k = 0; k < preds.length; k++) {
              n = preds[k];
              if (n < 0 || n > 63 || wall[n] || dist[n] <= nd) continue;
              dist[n] = nd; queue.push(n);
            }
            break;
          }
          case KNIGHT:
            for (k = 0; k < KNIGHT_T[c].length; k++) {
              n = KNIGHT_T[c][k];
              if (wall[n] || dist[n] <= nd) continue;
              dist[n] = nd; queue.push(n);
            }
            break;
          case KING:
            for (k = 0; k < KING_T[c].length; k++) {
              n = KING_T[c][k];
              if (wall[n] || dist[n] <= nd || E.inHomeRanks(-color, n)) continue;
              dist[n] = nd; queue.push(n);
            }
            break;
          default: {
            var d0 = t === BISHOP ? 4 : 0, d1 = t === ROOK ? 4 : 8;
            for (k = d0; k < d1; k++) {
              ray = RAYS[c * 8 + k];
              for (var j = 0; j < ray.length; j++) {
                n = ray[j];
                if (wall[n]) break;
                if (dist[n] > nd) { dist[n] = nd; queue.push(n); }
              }
            }
          }
        }
      }
      maps.push(dist);
    }
    // cheapest way back for each reserve slot: rise on the best muster square, then walk
    var muster = [CAP, CAP, CAP, CAP, CAP, CAP], ms = MUSTER[color];
    for (i = 0; i < ms.length; i++) {
      s = ms[i];
      var rr = s >> 3;
      if (rr !== 0 && rr !== 7) muster[0] = Math.min(muster[0], maps[PAWN][s]);
      muster[1] = Math.min(muster[1], maps[KNIGHT][s]);
      if (isLight(s)) muster[2] = Math.min(muster[2], maps[BISHOP][s]);
      else muster[3] = Math.min(muster[3], maps[BISHOP][s]);
      muster[4] = Math.min(muster[4], maps[ROOK][s]);
      muster[5] = Math.min(muster[5], maps[QUEEN][s]);
    }
    // A home square nothing can reach any more (a1 once a2 and b1 are sealed, say)
    // means one piece can never finish, wherever it stands right now.
    var locked = 0;
    for (s = 0; s < 64; s++) {
      t = home[s];
      if (!t || t >= QUEEN || wall[s]) continue;
      if (!opensOut(s, t, color, wall)) locked++;
    }
    return { maps: maps, muster: muster, sealed: popcount(key), locked: locked };
  }

  // can a piece of type t still walk into home square h from outside the court?
  function opensOut(h, t, color, wall) {
    var seen = new Uint8Array(64), queue = [h], head = 0, c, k, n, ray, j;
    seen[h] = 1;
    while (head < queue.length) {
      c = queue[head++];
      if (!E.inHomeRanks(color, c)) return true;
      var next = [];
      if (t === PAWN) {
        var fwd = color === WHITE ? 8 : -8, f = c & 7;
        if (c + fwd >= 0 && c + fwd < 64) {
          next.push(c + fwd);
          if (f > 0) next.push(c + fwd - 1);
          if (f < 7) next.push(c + fwd + 1);
        }
      } else if (t === KNIGHT) next = KNIGHT_T[c];
      else {
        for (k = (t === BISHOP ? 4 : 0); k < (t === ROOK ? 4 : 8); k++) {
          ray = RAYS[c * 8 + k];
          for (j = 0; j < ray.length; j++) { if (wall[ray[j]]) break; next.push(ray[j]); }
        }
      }
      for (k = 0; k < next.length; k++) {
        n = next[k];
        if (!seen[n] && !wall[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    return false;
  }

  function getMaps(b, color) {
    var key = wallKey(b, color), cache = mapCache[color], m = cache.get(key);
    if (!m) {
      if (cache.size > 4096) cache.clear();
      m = buildMaps(color, key);
      cache.set(key, m);
    }
    return m;
  }

  // ---- evaluation ----------------------------------------------------------------------
  // "Work" is the number of moves an army still needs to stand complete at home.
  var SLOT_TYPE = [PAWN, KNIGHT, BISHOP, BISHOP, ROOK, QUEEN];

  function sideScore(pos, color) {
    var b = pos.board, home = color === WHITE ? HOME_W : HOME_B;
    var M = getMaps(b, color), maps = M.maps;
    var res = pos.reserve, base = color === WHITE ? 0 : 6;
    var work = 0, royal = 0, musterPieces = 0, queenOn = false, s, p, i, rd;
    for (s = 0; s < 64; s++) {
      p = b[s] * color;
      if (p <= 0) continue;
      if (p < QUEEN && home[s] === p) continue;              // sealed: nothing left to do
      if (E.inMuster(color, s)) musterPieces++;
      if (p === KING || p === QUEEN) {
        if (p === QUEEN) queenOn = true;
        rd = maps[p][s];
        if (rd >= CAP) work += CAP;                 // walled out of its home square for good
        else royal += rd;
      } else work += maps[p][s];
    }
    var reserveLeft = 0;
    for (i = 0; i < 5; i++) {
      var n = res[base + i];
      if (n) { reserveLeft += n; work += n * (1 + M.muster[i]); }
    }
    if (res[base + 5]) {
      reserveLeft++;
      if (M.muster[5] >= CAP) work += CAP; else royal += 1 + M.muster[5];
    }
    // enemy pieces squatting on home squares we still need
    var list = SEAL_SQS[color];
    for (i = 0; i < list.length; i++) {
      p = b[list[i]];
      if (p * color < 0) work += W.squatted;
    }
    if (reserveLeft > 0 && musterPieces === 0) work += W.noRallier;
    work += M.locked * CAP;
    // the royals feel home's pull as the army fills in...
    var phase = M.sealed / 14;
    work += royal * (W.royalEarly + (1 - W.royalEarly) * phase);
    // ...but a royal back in its own court can't raise anyone, so while comrades
    // still wait in the reserve, sitting at home costs a little
    if (reserveLeft > 0) {
      var ks2 = pos.kings[color === WHITE ? 0 : 1];
      if (ks2 >= 0 && E.inHomeRanks(color, ks2)) work += W.courtIdle;
      for (s = 0; s < 64; s++) if (b[s] === color * QUEEN && E.inHomeRanks(color, s)) work += W.courtIdle;
    }
    var sc = -work * W.work;
    if (queenOn) sc += W.queen;
    if (reserveLeft > 0) sc += W.muster * Math.min(musterPieces, reserveLeft, 3);
    return sc;
  }

  // Grand Revival: the revival score (comrades risen + pieces home) is worth something by
  // itself, and more as the clock runs down (the caller passes the weight with each request)
  var REVIVE = 0, REVIVAL = false;

  function evaluate(pos) {
    var e = sideScore(pos, WHITE) - sideScore(pos, BLACK);
    if (REVIVE) e += REVIVE * (pos.revivalScore(WHITE) - pos.revivalScore(BLACK));
    var v = (pos.side === WHITE ? e : -e) + W.tempo;
    if (pos.inCheck(pos.side)) v -= W.check;
    return v;
  }

  // moves still needed by `color` (handy for the UI and for the notebook's analysis)
  function workLeft(pos, color) {
    var b = pos.board, home = color === WHITE ? HOME_W : HOME_B, M = getMaps(b, color), maps = M.maps;
    var res = pos.reserve, base = color === WHITE ? 0 : 6, work = 0, s, p;
    for (s = 0; s < 64; s++) {
      p = b[s] * color;
      if (p <= 0 || (p < QUEEN && home[s] === p)) continue;
      work += maps[p][s];
    }
    for (var i = 0; i < 6; i++) work += res[base + i] * (1 + M.muster[i]);
    return work;
  }

  // ---- fast pseudo-legal generator ------------------------------------------------------
  var rankBuf = new Int8Array(6);

  // rally types for a square, most useful first (the queen always comes back first)
  function rallyRank(pos, color, sq, out, M) {
    var mask = pos.rallyMask(color, sq), n = 0, gains = [0, 0, 0, 0, 0, 0];
    if (!mask) return 0;
    var light = isLight(sq);
    for (var t = PAWN; t <= QUEEN; t++) {
      if (!(mask & (1 << t))) continue;
      var slot = t === PAWN ? 0 : t === KNIGHT ? 1 : t === BISHOP ? (light ? 2 : 3) : t === ROOK ? 4 : 5;
      var g = t === QUEEN ? 1000 : (1 + M.muster[slot]) - M.maps[t][sq];
      var j = n++;
      while (j > 0 && gains[j - 1] < g) { gains[j] = gains[j - 1]; out[j] = out[j - 1]; j--; }
      gains[j] = g; out[j] = t;
    }
    return n;
  }

  function canTake(b, sq, us) {
    var p = b[sq];
    if (p === 0) return true;
    if (p * us > 0 || p === -us * KING) return false;
    if (E.sealedAt(p, sq)) return false;
    if (p === -us * QUEEN) return true;
    if (p > 0 ? (sq >> 3) > 3 : (sq >> 3) < 4) return true;               // exposed in enemy land
    var n = KING_T[sq];
    for (var i = 0; i < n.length; i++) if (b[n[i]] * p > 0) return false;   // shielded by a friend
    return true;
  }

  // width: how many rally variants per origin square
  function genMoves(pos, out, width, capsOnly) {
    out.length = 0;
    var b = pos.board, us = pos.side, home = us === WHITE ? HOME_W : HOME_B;
    var s, pc, i, t, list, ray, d, n, k, m;
    var M = capsOnly ? null : getMaps(b, us);
    for (s = 0; s < 64; s++) {
      pc = b[s] * us;
      if (pc <= 0) continue;
      if (pc < QUEEN && home[s] === pc) continue;
      n = capsOnly ? 0 : rallyRank(pos, us, s, rankBuf, M);
      if (n > width) n = width;
      var startLen = out.length;
      switch (pc) {
        case PAWN: {
          var back = s - 8 * us, r = s >> 3, f = s & 7;
          if (back < 0 || back > 63) break;
          if (!capsOnly && b[back] === 0) {
            out.push(s | (back << 6));
            if ((us === WHITE && r === 3) || (us === BLACK && r === 4)) {
              var two = back - 8 * us;
              if (b[two] === 0) out.push(s | (two << 6));
            }
          }
          if (capsOnly) break;
          if (f > 0 && b[back - 1] === 0) out.push(s | ((back - 1) << 6));
          if (f < 7 && b[back + 1] === 0) out.push(s | ((back + 1) << 6));
          break;
        }
        case KNIGHT:
          if (capsOnly) break;
          list = KNIGHT_T[s];
          for (i = 0; i < list.length; i++) if (b[list[i]] === 0) out.push(s | (list[i] << 6));
          break;
        case KING:
          list = KING_T[s];
          for (i = 0; i < list.length; i++) {
            t = list[i];
            if (capsOnly ? (b[t] !== 0 && canTake(b, t, us)) : canTake(b, t, us)) out.push(s | (t << 6));
          }
          break;
        default: {
          if (capsOnly && pc !== QUEEN) break;
          var d0 = pc === BISHOP ? 4 : 0, d1 = pc === ROOK ? 4 : 8;
          for (d = d0; d < d1; d++) {
            ray = RAYS[s * 8 + d];
            for (i = 0; i < ray.length; i++) {
              t = ray[i];
              if (b[t] === 0) { if (!capsOnly) out.push(s | (t << 6)); continue; }
              if (pc === QUEEN && canTake(b, t, us)) out.push(s | (t << 6));
              break;
            }
          }
        }
      }
      // nobody enters the enemy court: drop those targets
      var w = startLen;
      for (i = startLen; i < out.length; i++) {
        t = (out[i] >> 6) & 63;
        if (us === WHITE ? t < 48 : t > 15) out[w++] = out[i];
      }
      out.length = w;
      // turn the bare moves of this piece into rally variants
      if (n > 0) {
        var endLen = out.length;
        for (i = startLen; i < endLen; i++) {
          m = out[i];
          out[i] = m | (rankBuf[0] << 12);
          for (k = 1; k < n; k++) out.push(m | (rankBuf[k] << 12));
        }
      }
      if (!capsOnly && pc !== KING) out.push(s | (s << 6) | RECALL);
    }
    return out;
  }

  // ---- search ---------------------------------------------------------------------------------
  var VALUE = [0, 100, 300, 320, 500, 900, 0];

  function Searcher() {
    var size = 1 << 18;
    this.ttMask = size - 1;
    this.ttLo = new Int32Array(size);
    this.ttHi = new Int32Array(size);
    this.ttScore = new Int32Array(size);
    this.ttMove = new Int32Array(size);
    this.ttDepth = new Int8Array(size);
    this.ttFlag = new Int8Array(size);
    this.killers = new Int32Array(128 * 2);
    this.hist = new Int32Array(64 * 64);
    this.nodes = 0;
    this.stopAt = 0;
    this.stopped = false;
    this.moves = [];
    this.scores = [];
    for (var i = 0; i < 128; i++) { this.moves.push([]); this.scores.push([]); }
  }

  Searcher.prototype.clear = function () {
    this.ttFlag.fill(0);
    this.killers.fill(0);
    this.hist.fill(0);
  };

  Searcher.prototype.orderScore = function (pos, m, ply, ttMove) {
    if (m === ttMove) return 1 << 26;
    if (m & (RECALL | PASS)) return -100000;
    var b = pos.board, from = m & 63, to = (m >> 6) & 63, rally = (m >> 12) & 7;
    var pc = b[from], t = pc < 0 ? -pc : pc, sc = 0, cap = b[to];
    if (cap !== 0) sc += 1000000 + VALUE[cap < 0 ? -cap : cap] * 10 - t;
    if (t < QUEEN && E.sealedAt(pc, to)) sc += 500000 + VALUE[t];
    if (rally) sc += 20000 + VALUE[rally];
    if (this.killers[ply * 2] === m) sc += 150000;
    else if (this.killers[ply * 2 + 1] === m) sc += 140000;
    sc += this.hist[from * 64 + to];
    return sc;
  };

  function sortBy(moves, scores, n) {
    for (var i = 1; i < n; i++) {
      var m = moves[i], s = scores[i], j = i - 1;
      while (j >= 0 && scores[j] < s) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
      moves[j + 1] = m; scores[j + 1] = s;
    }
  }

  Searcher.prototype.timeUp = function () {
    if ((++this.nodes & 2047) === 0 && Date.now() > this.stopAt) this.stopped = true;
    return this.stopped;
  };

  // was the move just made legal for the mover? (own king safe)
  function moverSafe(pos) {
    var mover = -pos.side;
    var ks = pos.kings[mover === WHITE ? 0 : 1];
    return !pos.attacked(ks, pos.side);
  }

  // A draw is worth a little less than nothing to the computer ("contempt"), so it
  // keeps playing for the win instead of steering into early repetitions.
  var CONTEMPT = 60;
  var rootSide = WHITE;
  function drawScore(pos) { return pos.side === rootSide ? -CONTEMPT : CONTEMPT; }

  // checks done right after a move: a completed formation, or dawn
  function afterMove(pos, ply) {
    var mover = -pos.side, b = pos.board;
    var home = mover === WHITE ? HOME_W : HOME_B, full = true, s;
    for (s = 0; s < 64 && full; s++) if (home[s] && b[s] !== mover * home[s]) full = false;
    if (full) return -(WIN - ply);
    // repeating a position is treated as going nowhere: the computer only does it
    // when everything else is worse (the game itself never ends on repetition)
    if (pos.clock >= 4 && pos.repetitions() >= 1) return drawScore(pos);
    if (pos.ply >= pos.maxPly) {
      var a, c;
      if (REVIVAL) {
        // the Grand Revival is decided by the revival score, then by pieces home
        a = pos.revivalScore(pos.side); c = pos.revivalScore(mover);
        if (a === c) { a = pos.formationScore(pos.side); c = pos.formationScore(mover); }
        if (a === c) return drawScore(pos);
        return a > c ? (DAWN_WIN - ply) : -(DAWN_WIN - ply);
      }
      a = pos.formationScore(pos.side); c = pos.formationScore(mover);
      if (a === c) {
        a = pos.piecesOnBoard(pos.side); c = pos.piecesOnBoard(mover);
        if (a === c) return drawScore(pos);
      }
      return a > c ? (DAWN_WIN - ply) : -(DAWN_WIN - ply);
    }
    return null;
  }

  Searcher.prototype.quiesce = function (pos, alpha, beta, ply, qd) {
    if (this.timeUp()) return 0;
    var stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd <= 0 || ply >= 120) return alpha;
    var moves = this.moves[ply], scores = this.scores[ply], b = pos.board, i, n;
    genMoves(pos, moves, 0, true);
    n = moves.length;
    for (i = 0; i < n; i++) {
      var v = b[(moves[i] >> 6) & 63], a = b[moves[i] & 63];
      scores[i] = VALUE[v < 0 ? -v : v] * 10 - (a < 0 ? -a : a);
    }
    sortBy(moves, scores, n);
    for (i = 0; i < n; i++) {
      var m = moves[i];
      pos.make(m);
      if (!moverSafe(pos)) { pos.unmake(); continue; }
      var term = afterMove(pos, ply + 1);
      var sc = term !== null ? -term : -this.quiesce(pos, -beta, -alpha, ply + 1, qd - 1);
      pos.unmake();
      if (this.stopped) return 0;
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  };

  Searcher.prototype.search = function (pos, depth, alpha, beta, ply) {
    if (this.timeUp()) return 0;
    if (ply >= 100) return evaluate(pos);
    var inCheck = pos.inCheck(pos.side);
    // checks are answered one ply deeper, but only a few times per line
    if (depth <= 0 && (!inCheck || ply > 24)) return this.quiesce(pos, alpha, beta, ply, 6);
    if (depth < 0) depth = 0;
    var alpha0 = alpha, ttMove = 0, i = pos.hashLo & this.ttMask;
    if (this.ttFlag[i] !== 0 && this.ttLo[i] === pos.hashLo && this.ttHi[i] === pos.hashHi) {
      ttMove = this.ttMove[i];
      if (this.ttDepth[i] >= depth && ply > 0) {
        var ts = this.ttScore[i], tf = this.ttFlag[i];
        if (tf === 1) return ts;
        if (tf === 2 && ts >= beta) return ts;
        if (tf === 3 && ts <= alpha) return ts;
      }
    }
    var moves = this.moves[ply], scores = this.scores[ply];
    genMoves(pos, moves, ply < 2 ? 3 : 2, false);
    var n = moves.length;
    for (i = 0; i < n; i++) scores[i] = this.orderScore(pos, moves[i], ply, ttMove);
    sortBy(moves, scores, n);

    var best = -INF, bestMove = 0, legal = 0;
    for (i = 0; i < n; i++) {
      var m = moves[i];
      pos.make(m);
      if (!moverSafe(pos)) { pos.unmake(); continue; }
      legal++;
      var term = afterMove(pos, ply + 1), sc;
      if (term !== null) sc = -term;
      else if (legal === 1) sc = -this.search(pos, depth - 1, -beta, -alpha, ply + 1);
      else {
        var quiet = pos.uCap[pos.sp - 1] === 0 && !((m >> 12) & 7);
        var red = (depth >= 3 && legal > 6 && !inCheck && quiet) ? 1 : 0;
        sc = -this.search(pos, depth - 1 - red, -alpha - 1, -alpha, ply + 1);
        if (sc > alpha && sc < beta && !this.stopped) sc = -this.search(pos, depth - 1, -beta, -alpha, ply + 1);
      }
      pos.unmake();
      if (this.stopped) return 0;
      if (sc > best) { best = sc; bestMove = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (pos.board[(m >> 6) & 63] === 0 && !(m & RECALL)) {
          var kslot = ply * 2;
          if (this.killers[kslot] !== m) { this.killers[kslot + 1] = this.killers[kslot]; this.killers[kslot] = m; }
          this.hist[(m & 63) * 64 + ((m >> 6) & 63)] += depth * depth;
        }
        break;
      }
    }
    if (legal === 0) {
      // in check with no way out: the previous move cornered us, which the realm forbids
      if (inCheck) return WIN - ply;
      // nothing to do at all: the turn passes
      pos.make(PASS);
      var ps = -this.search(pos, depth - 1, -beta, -alpha, ply + 1);
      pos.unmake();
      return ps;
    }
    var flag = best <= alpha0 ? 3 : (best >= beta ? 2 : 1);
    var j = pos.hashLo & this.ttMask;
    if (!(this.ttFlag[j] !== 0 && this.ttDepth[j] > depth && this.ttLo[j] === pos.hashLo)) {
      this.ttLo[j] = pos.hashLo; this.ttHi[j] = pos.hashHi;
      this.ttDepth[j] = depth; this.ttFlag[j] = flag; this.ttScore[j] = best; this.ttMove[j] = bestMove;
    }
    return best;
  };

  // Root search. With `exactAll` every move gets a full-window search so its
  // score is exact (the beginner needs honest alternatives to slip into);
  // otherwise it is a normal PVS root and only some scores are exact.
  Searcher.prototype.root = function (pos, depth, list, exactAll) {
    var alpha = -INF, beta = INF;
    for (var i = 0; i < list.length; i++) {
      var m = list[i].move;
      pos.make(m);
      var term = afterMove(pos, 1), sc, exact = true;
      if (term !== null) sc = -term;
      else if (i === 0 || exactAll) sc = -this.search(pos, depth - 1, -beta, exactAll ? INF : -alpha, 1);
      else {
        sc = -this.search(pos, depth - 1, -alpha - 1, -alpha, 1);
        if (sc > alpha && !this.stopped) sc = -this.search(pos, depth - 1, -beta, -alpha, 1);
        else exact = false;                 // failed low: only an upper bound
      }
      pos.unmake();
      if (this.stopped) return false;
      list[i].score = exact ? sc : Math.min(sc, alpha) - 1;
      list[i].exact = exact;
      if (sc > alpha) alpha = sc;
    }
    return true;
  };

  var LEVELS = {
    beginner: { maxDepth: 2, timeMs: 500, noise: 45, slipChance: 0.35, slipWindow: 140 },
    expert: { maxDepth: 8, timeMs: 1200, noise: 4, slipChance: 0, slipWindow: 0 }
  };

  function makeRng(seed) {
    var s = (seed >>> 0) || 0x2545f491;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  var shared = null, lastMode = 'false:0';

  function think(pos, options) {
    options = options || {};
    var level = LEVELS[options.level] || LEVELS.expert;
    var maxDepth = options.maxDepth || level.maxDepth;
    var timeMs = options.timeMs || level.timeMs;
    var rand = makeRng(options.seed || (Date.now() & 0x7fffffff));
    REVIVAL = options.ending === 'revival';
    REVIVE = REVIVAL ? (+options.revive || 0) : 0;
    var S = shared || (shared = new Searcher());
    var modeKey = REVIVAL + ':' + REVIVE;
    if (modeKey !== lastMode) { S.clear(); lastMode = modeKey; }   // stored scores used other rules
    S.killers.fill(0);
    for (var h = 0; h < S.hist.length; h++) S.hist[h] >>= 3;
    S.nodes = 0; S.stopped = false;
    var started = Date.now();
    S.stopAt = started + timeMs;
    rootSide = pos.side;

    var legal = pos.legalMoves([]);
    if (legal.length === 1) return { move: legal[0], score: 0, depth: 0, nodes: 0, ms: 0 };

    // an immediate MateCheck needs no thought
    for (var i = 0; i < legal.length; i++) {
      pos.make(legal[i]);
      var done = pos.formationComplete(-pos.side);
      pos.unmake();
      if (done) return { move: legal[i], score: WIN, depth: 1, nodes: legal.length, ms: Date.now() - started };
    }

    var list = legal.map(function (m) { return { move: m, score: -INF, order: S.orderScore(pos, m, 0, 0) }; });
    list.sort(function (a, b) { return b.order - a.order; });

    var finished = null, depthDone = 0;
    var exactAll = (options.slipChance != null ? options.slipChance : level.slipChance) > 0;
    for (var depth = 1; depth <= maxDepth; depth++) {
      var trial = list.map(function (r) { return { move: r.move, score: -INF, exact: false }; });
      if (!S.root(pos, depth, trial, exactAll)) break;
      trial.sort(function (a, b) { return b.score - a.score; });
      finished = trial;
      list = trial;
      depthDone = depth;
      if (Math.abs(trial[0].score) >= WIN_BOUND) break;
      if (Date.now() - started > timeMs * 0.45) break;
    }
    if (!finished) finished = list;

    // A touch of variety: pick among moves whose scores are exact and close to
    // the best. The beginner sometimes widens that window into a real slip.
    var pick = finished[0];
    if (Math.abs(pick.score) < DAWN_WIN - 1000) {
      var noise = options.noise != null ? options.noise : level.noise;
      var slip = options.slipChance != null ? options.slipChance : level.slipChance;
      var windowSize = (slip > 0 && rand() < slip) ? level.slipWindow : noise * 2;
      var top = pick.score, bestNoisy = -INF;
      for (i = 0; i < finished.length; i++) {
        var c = finished[i];
        if (c.score < top - windowSize) break;
        if (!c.exact) continue;
        var nv = c.score + (rand() * 2 - 1) * (windowSize > noise * 2 ? windowSize / 2 : noise);
        if (nv > bestNoisy) { bestNoisy = nv; pick = c; }
      }
    }
    return { move: pick.move, score: pick.score, depth: depthDone, nodes: S.nodes, ms: Date.now() - started };
  }

  return {
    think: think,
    evaluate: evaluate,
    workLeft: workLeft,
    setWeights: setWeights,
    weights: W,
    LEVELS: LEVELS,
    clearMemory: function () { if (shared) shared.clear(); }
  };
}));
