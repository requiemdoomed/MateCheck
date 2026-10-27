/*
 * MateCheck - rules engine
 * Copyright (c) 2026 Swayam Shakya
 * Released under the MIT License (see LICENSE in the project root)
 *
 * How the reversed realm works, in one breath:
 *   - both sides begin with only a King and a Queen
 *   - every move may "rally": a fallen comrade rises on the square you just left,
 *     as long as that square is on your muster ground (ranks 3-4 for white, 5-6 for black)
 *   - pieces that reach their starting square are sealed there for good
 *   - pawns march backwards, home to their own second rank
 *   - only the royals still strike: a king or queen can banish an enemy comrade
 *     back to its reserve; risen comrades never strike and never give check
 *   - comrades shield each other: in its own half of the board, a comrade standing
 *     next to a friendly piece can't be banished
 *   - no piece ever enters the enemy's court (their two home ranks)
 *   - check still exists, but checkmate does not: no move may corner a king
 *   - first army to stand complete in the classic opening setup wins (MateCheck!)
 *
 * Board layout: a1 = 0, b1 = 1 ... h8 = 63.
 * Pieces are small ints, positive for white, negative for black.
 *
 * The whole thing lives inside one factory function on purpose: the computer's worker
 * rebuilds the engine from this function's source text, so nothing in here may
 * reach for outside variables.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  api.factory = factory;
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MateCheckEngine = api;
}(typeof self !== 'undefined' ? self : this, function buildMateCheckEngine() {
  'use strict';

  var WHITE = 1, BLACK = -1;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var RECALL = 1 << 15;
  var PASS = 1 << 16;                 // only offered when nothing else is legal
  var DEFAULT_MAX_PLY = 200;          // "dawn" - 100 moves each

  // reserve slots (bishops are tied to a square colour, just like real chess)
  var S_PAWN = 0, S_KNIGHT = 1, S_LIGHT_B = 2, S_DARK_B = 3, S_ROOK = 4, S_QUEEN = 5;
  var SLOT_LETTERS = 'PNLDRQ';

  var FILES = 'abcdefgh';
  var LETTER = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
  var NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

  function fileOf(s) { return s & 7; }
  function rankOf(s) { return s >> 3; }
  function isLight(s) { return ((s & 7) + (s >> 3)) & 1; }
  function sqName(s) { return FILES[s & 7] + ((s >> 3) + 1); }
  function parseSq(name) {
    if (typeof name !== 'string' || name.length !== 2) return -1;
    var f = FILES.indexOf(name[0]), r = name.charCodeAt(1) - 49;
    return (f < 0 || r < 0 || r > 7) ? -1 : r * 8 + f;
  }

  // ---- home squares -------------------------------------------------------
  var BACK_ROW = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
  var HOME_W = new Int8Array(64), HOME_B = new Int8Array(64);
  for (var f0 = 0; f0 < 8; f0++) {
    HOME_W[f0] = BACK_ROW[f0];
    HOME_W[8 + f0] = PAWN;
    HOME_B[56 + f0] = BACK_ROW[f0];
    HOME_B[48 + f0] = PAWN;
  }
  function homeTable(color) { return color === WHITE ? HOME_W : HOME_B; }

  // a piece standing on its own starting square is sealed (kings and queens never are)
  function sealedAt(piece, sq) {
    if (piece === 0) return false;
    var t = piece > 0 ? piece : -piece;
    if (t >= QUEEN) return false;
    return (piece > 0 ? HOME_W[sq] : HOME_B[sq]) === t;
  }

  // the two home ranks of a side (where its army stands at the start of real chess)
  function inHomeRanks(color, sq) {
    var r = sq >> 3;
    return color === WHITE ? r <= 1 : r >= 6;
  }

  // the muster ground: the two ranks just in front of home - the only place the fallen rise
  function inMuster(color, sq) {
    var r = sq >> 3;
    return color === WHITE ? (r === 2 || r === 3) : (r === 4 || r === 5);
  }

  // ---- precomputed geometry ----------------------------------------------
  var KNIGHT_T = [], KING_T = [], RAYS = [];
  var PAWN_ATT_W = [], PAWN_ATT_B = [];   // squares a pawn must stand on to hit sq
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  var KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

  (function precompute() {
    for (var s = 0; s < 64; s++) {
      var f = s & 7, r = s >> 3, i, nf, nr, list;
      list = [];
      for (i = 0; i < 8; i++) {
        nf = f + KN[i][0]; nr = r + KN[i][1];
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) list.push(nr * 8 + nf);
      }
      KNIGHT_T[s] = list;
      list = [];
      for (i = 0; i < 8; i++) {
        nf = f + DIRS[i][0]; nr = r + DIRS[i][1];
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) list.push(nr * 8 + nf);
      }
      KING_T[s] = list;
      for (i = 0; i < 8; i++) {
        var ray = [];
        nf = f + DIRS[i][0]; nr = r + DIRS[i][1];
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          ray.push(nr * 8 + nf);
          nf += DIRS[i][0]; nr += DIRS[i][1];
        }
        RAYS[s * 8 + i] = ray;
      }
      // pawns march backwards and banish diagonally backwards.
      // A white pawn on (f, r) hits (f +- 1, r - 1), so it hits sq from (f -+ 1, r + 1).
      var w = [], b = [];
      if (r < 7) {
        if (f > 0) w.push(s + 7);
        if (f < 7) w.push(s + 9);
      }
      if (r > 0) {
        if (f > 0) b.push(s - 9);
        if (f < 7) b.push(s - 7);
      }
      PAWN_ATT_W[s] = w;
      PAWN_ATT_B[s] = b;
    }
  }());

  // ---- zobrist keys (deterministic, so hashes match across threads) --------
  var seed = 0x9e3779b9 | 0;
  function rnd32() {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed | 0;
  }
  var Z_PIECE_LO = new Int32Array(13 * 64), Z_PIECE_HI = new Int32Array(13 * 64);
  var Z_RES_LO = new Int32Array(12 * 10), Z_RES_HI = new Int32Array(12 * 10);
  for (var zi = 0; zi < 13 * 64; zi++) { Z_PIECE_LO[zi] = rnd32(); Z_PIECE_HI[zi] = rnd32(); }
  for (zi = 0; zi < 12 * 10; zi++) { Z_RES_LO[zi] = rnd32(); Z_RES_HI[zi] = rnd32(); }
  var Z_SIDE_LO = rnd32(), Z_SIDE_HI = rnd32();

  function slotFor(piece, sq) {
    var t = piece > 0 ? piece : -piece;
    switch (t) {
      case PAWN: return S_PAWN;
      case KNIGHT: return S_KNIGHT;
      case BISHOP: return isLight(sq) ? S_LIGHT_B : S_DARK_B;
      case ROOK: return S_ROOK;
      case QUEEN: return S_QUEEN;
      default: return -1;
    }
  }

  // ---- battlefields ---------------------------------------------------------
  var BATTLEFIELDS = {
    'last-stand': {
      name: 'The Last Stand',
      blurb: 'Both kings shield their queens near home. Quick to learn, tight to master.',
      white: { K: 'd3', Q: 'd2' }, black: { K: 'd6', Q: 'd7' }
    },
    'crossroads': {
      name: 'Crossroads',
      blurb: 'The royals meet in open country. Expect early raids.',
      white: { K: 'b3', Q: 'e3' }, black: { K: 'g6', Q: 'd6' }
    },
    'long-road': {
      name: 'The Long Road',
      blurb: 'Each royal pair wakes up deep in enemy land and must march home.',
      white: { K: 'b6', Q: 'f5' }, black: { K: 'g3', Q: 'c4' }
    }
  };
  var FULL_RESERVE = [8, 2, 1, 1, 2, 0];

  // ---- the position ---------------------------------------------------------
  var STACK = 1024;

  function Position() {
    this.board = new Int8Array(64);
    this.reserve = new Int8Array(12);   // white slots 0..5, black 6..11
    this.kings = new Int8Array(2);      // [white king sq, black king sq]
    this.side = WHITE;
    this.ply = 0;
    this.maxPly = DEFAULT_MAX_PLY;
    this.clock = 0;                     // plies since something irreversible happened
    this.hashLo = 0;
    this.hashHi = 0;
    this.sp = 0;
    this.uMove = new Int32Array(STACK);
    this.uCap = new Int8Array(STACK);
    this.uClock = new Int16Array(STACK);
    this.uHashLo = new Int32Array(STACK);
    this.uHashHi = new Int32Array(STACK);
  }

  Position.prototype.clear = function () {
    this.board.fill(0);
    this.reserve.fill(0);
    this.kings[0] = this.kings[1] = -1;
    this.side = WHITE;
    this.ply = 0;
    this.clock = 0;
    this.sp = 0;
  };

  Position.prototype.rehash = function () {
    var lo = 0, hi = 0, s, p, i;
    for (s = 0; s < 64; s++) {
      p = this.board[s];
      if (p !== 0) { lo ^= Z_PIECE_LO[(p + 6) * 64 + s]; hi ^= Z_PIECE_HI[(p + 6) * 64 + s]; }
    }
    for (i = 0; i < 12; i++) {
      lo ^= Z_RES_LO[i * 10 + this.reserve[i]];
      hi ^= Z_RES_HI[i * 10 + this.reserve[i]];
    }
    if (this.side === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    this.hashLo = lo; this.hashHi = hi;
  };

  Position.prototype.findKings = function () {
    this.kings[0] = this.kings[1] = -1;
    for (var s = 0; s < 64; s++) {
      if (this.board[s] === KING) this.kings[0] = s;
      else if (this.board[s] === -KING) this.kings[1] = s;
    }
  };

  Position.prototype.setupBattlefield = function (id, maxPly) {
    var bf = BATTLEFIELDS[id] || BATTLEFIELDS['last-stand'];
    this.clear();
    this.board[parseSq(bf.white.K)] = KING;
    this.board[parseSq(bf.white.Q)] = QUEEN;
    this.board[parseSq(bf.black.K)] = -KING;
    this.board[parseSq(bf.black.Q)] = -QUEEN;
    for (var i = 0; i < 6; i++) { this.reserve[i] = FULL_RESERVE[i]; this.reserve[6 + i] = FULL_RESERVE[i]; }
    this.maxPly = maxPly || DEFAULT_MAX_PLY;
    this.findKings();
    this.rehash();
    return this;
  };

  // Compact text form: "<board> <side> <white reserve> <black reserve> <ply> <maxPly>"
  // board is FEN-like (rank 8 first), reserve looks like P8N2L1D1R2Q0
  Position.prototype.toString = function () {
    var out = '', r, f, empty, p;
    for (r = 7; r >= 0; r--) {
      empty = 0;
      for (f = 0; f < 8; f++) {
        p = this.board[r * 8 + f];
        if (p === 0) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p > 0 ? LETTER[p] : LETTER[-p].toLowerCase();
      }
      if (empty) out += empty;
      if (r) out += '/';
    }
    return out + ' ' + (this.side === WHITE ? 'w' : 'b') + ' ' +
      this.reserveString(WHITE) + ' ' + this.reserveString(BLACK) + ' ' + this.ply + ' ' + this.maxPly;
  };

  Position.prototype.reserveString = function (color) {
    var base = color === WHITE ? 0 : 6, s = '';
    for (var i = 0; i < 6; i++) s += SLOT_LETTERS[i] + this.reserve[base + i];
    return s;
  };

  Position.prototype.load = function (text) {
    var parts = String(text).trim().split(/\s+/);
    this.clear();
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('bad board: ' + parts[0]);
    for (var i = 0; i < 8; i++) {
      var r = 7 - i, f = 0, row = rows[i];
      for (var j = 0; j < row.length; j++) {
        var ch = row[j];
        if (ch >= '1' && ch <= '8') { f += ch.charCodeAt(0) - 48; continue; }
        var t = LETTER.indexOf(ch.toUpperCase());
        if (t < 1 || f > 7) throw new Error('bad board: ' + parts[0]);
        this.board[r * 8 + f] = ch === ch.toUpperCase() ? t : -t;
        f++;
      }
    }
    this.side = parts[1] === 'b' ? BLACK : WHITE;
    readReserve(this.reserve, 0, parts[2] || 'P0N0L0D0R0Q0');
    readReserve(this.reserve, 6, parts[3] || 'P0N0L0D0R0Q0');
    this.ply = parts[4] ? parseInt(parts[4], 10) || 0 : 0;
    this.maxPly = parts[5] ? parseInt(parts[5], 10) || DEFAULT_MAX_PLY : DEFAULT_MAX_PLY;
    this.findKings();
    this.rehash();
    return this;
  };

  function readReserve(arr, base, text) {
    for (var i = 0; i < 6; i++) arr[base + i] = 0;
    var re = /([PNLDRQ])(\d)/g, m;
    while ((m = re.exec(text))) arr[base + SLOT_LETTERS.indexOf(m[1])] = parseInt(m[2], 10);
  }

  Position.prototype.clone = function () {
    var p = new Position();
    p.board.set(this.board);
    p.reserve.set(this.reserve);
    p.kings.set(this.kings);
    p.side = this.side; p.ply = this.ply; p.maxPly = this.maxPly; p.clock = this.clock;
    p.hashLo = this.hashLo; p.hashHi = this.hashHi;
    p.sp = this.sp;
    p.uMove.set(this.uMove); p.uCap.set(this.uCap); p.uClock.set(this.uClock);
    p.uHashLo.set(this.uHashLo); p.uHashHi.set(this.uHashHi);
    return p;
  };

  // ---- attacks ----------------------------------------------------------------
  // Only the royals still strike in the reversed realm, so only a king or a
  // queen can attack a square (and so give check).
  Position.prototype.attacked = function (sq, by) {
    var b = this.board, a, i, ray, p;
    var k = by * KING, q = by * QUEEN;
    a = KING_T[sq];
    for (i = 0; i < a.length; i++) if (b[a[i]] === k) return true;
    var base = sq * 8;
    for (var d = 0; d < 8; d++) {
      ray = RAYS[base + d];
      for (i = 0; i < ray.length; i++) {
        p = b[ray[i]];
        if (p !== 0) {
          if (p === q) return true;
          break;
        }
      }
    }
    return false;
  };

  Position.prototype.inCheck = function (color) {
    var ks = this.kings[color === WHITE ? 0 : 1];
    return ks >= 0 && this.attacked(ks, -color);
  };

  // royals of `by` that hit `sq` (for the UI and the tutorial)
  Position.prototype.attackersOf = function (sq, by) {
    var list = [], b = this.board, a, i, ray, p, base = sq * 8;
    a = KING_T[sq];
    for (i = 0; i < a.length; i++) if (b[a[i]] === by * KING) list.push(a[i]);
    for (var d = 0; d < 8; d++) {
      ray = RAYS[base + d];
      for (i = 0; i < ray.length; i++) {
        p = b[ray[i]];
        if (p !== 0) {
          if (p === by * QUEEN) list.push(ray[i]);
          break;
        }
      }
    }
    return list;
  };

  // ---- rally helpers ----------------------------------------------------------
  // bitmask of piece types (bit = 1 << type) that may rise on `sq` for `color`
  Position.prototype.rallyMask = function (color, sq) {
    if (!inMuster(color, sq)) return 0;
    var base = color === WHITE ? 0 : 6, res = this.reserve, r = sq >> 3, mask = 0;
    if (res[base + S_PAWN] > 0 && r !== 0 && r !== 7) mask |= 1 << PAWN;
    if (res[base + S_KNIGHT] > 0) mask |= 1 << KNIGHT;
    if (res[base + (isLight(sq) ? S_LIGHT_B : S_DARK_B)] > 0) mask |= 1 << BISHOP;
    if (res[base + S_ROOK] > 0) mask |= 1 << ROOK;
    if (res[base + S_QUEEN] > 0) mask |= 1 << QUEEN;
    return mask;
  };

  Position.prototype.rallyTypes = function (color, sq) {
    var mask = this.rallyMask(color, sq), out = [];
    for (var t = PAWN; t <= QUEEN; t++) if (mask & (1 << t)) out.push(t);
    return out;
  };

  // ---- move generation ------------------------------------------------------------
  // Legal means: your own king is not left attacked, and the enemy king is not
  // left attacked with no way out (the realm has outlawed checkmate).
  Position.prototype._addMove = function (out, from, to, us, kingMoving, depth) {
    if (inHomeRanks(-us, to)) return;              // the enemy court is off limits to everyone
    var b = this.board, cap = b[to], piece = b[from];
    var ks = kingMoving ? to : this.kings[us === WHITE ? 0 : 1];
    var eks = this.kings[us === WHITE ? 1 : 0];
    var mask = this.rallyMask(us, from);
    b[to] = piece; b[from] = 0;
    var illegal = this.attacked(ks, -us);
    var shieldOk = !illegal;
    if (illegal && mask) {
      // a comrade rising on the vacated square can still shield the king
      b[from] = us * PAWN;
      shieldOk = !this.attacked(ks, -us);
      b[from] = 0;
    }
    if (!shieldOk) { b[from] = piece; b[to] = cap; return; }
    // which variants give check? (only those need the expensive "is it mate?" look)
    var checks = 0, t, m = from | (to << 6);
    if (depth > 0 && eks >= 0) {
      if (!illegal && this.attacked(eks, us)) checks |= 1;
      for (t = PAWN; t <= QUEEN; t++) {
        if (!(mask & (1 << t))) continue;
        b[from] = us * t;
        if (this.attacked(eks, us)) checks |= 1 << t;
        b[from] = 0;
      }
    }
    b[from] = piece; b[to] = cap;
    if (!illegal && (!(checks & 1) || this._escapes(m, depth - 1))) out.push(m);
    for (t = PAWN; t <= QUEEN; t++) {
      if (!(mask & (1 << t))) continue;
      var mv = m | (t << 12);
      if (!(checks & (1 << t)) || this._escapes(mv, depth - 1)) out.push(mv);
    }
  };

  // After move m, can the side being checked get out of it with a move that
  // is itself legal? The question nests (an escape might corner the other
  // king), so it is asked a few levels deep and then trusted.
  Position.prototype._escapes = function (m, depth) {
    this.make(m);
    var bufs = this._escBufs || (this._escBufs = [[], [], [], [], []]);
    var buf = bufs[depth];
    this._generate(buf, depth, true);
    var ok = buf.length > 0;
    this.unmake();
    return ok;
  };

  Position.prototype._canTake = function (sq, us) {
    var p = this.board[sq];
    if (p === 0) return true;
    if (p * us > 0) return false;                  // own piece
    if (p === -us * KING) return false;            // kings are never banished
    if (sealedAt(p, sq)) return false;             // sealed pieces are untouchable
    return p === -us * QUEEN || !this.shielded(sq);
  };

  // a comrade in its own half with a friendly piece on a neighbouring square is shielded
  Position.prototype.shielded = function (sq) {
    var p = this.board[sq], b = this.board;
    if (p === 0) return false;
    var t = p > 0 ? p : -p;
    if (t === QUEEN || t === KING) return false;
    if (p > 0 ? (sq >> 3) > 3 : (sq >> 3) < 4) return false;   // out in enemy land: exposed
    var n = KING_T[sq];
    for (var i = 0; i < n.length; i++) if (b[n[i]] * p > 0) return true;
    return false;
  };

  var MATE_DEPTH = 3;

  Position.prototype.legalMoves = function (out) {
    out = out || [];
    this._generate(out, MATE_DEPTH, false);
    // never leave a king stuck in check: if every escape was filtered, allow them
    if (out.length === 0 && this.inCheck(this.side)) this._generate(out, 0, false);
    if (out.length === 0) out.push(PASS);
    return out;
  };

  Position.prototype._generate = function (out, depth, firstOnly) {
    out.length = 0;
    var b = this.board, us = this.side, home = homeTable(us);
    var s, pc, t, i, list, ray, d, a;
    for (s = 0; s < 64; s++) {
      pc = b[s] * us;
      if (pc <= 0) continue;
      if (pc < QUEEN && home[s] === pc) continue;  // sealed - it stays put forever
      switch (pc) {
        case PAWN: {
          var back = s - 8 * us, r = s >> 3, f = s & 7;
          if (back < 0 || back > 63) break;
          if (b[back] === 0) {
            this._addMove(out, s, back, us, false, depth);
            // the reverse of the opening double step
            if ((us === WHITE && r === 3) || (us === BLACK && r === 4)) {
              var two = back - 8 * us;
              if (b[two] === 0) this._addMove(out, s, two, us, false, depth);
            }
          }
          if (f > 0 && b[back - 1] === 0) this._addMove(out, s, back - 1, us, false, depth);
          if (f < 7 && b[back + 1] === 0) this._addMove(out, s, back + 1, us, false, depth);
          break;
        }
        case KNIGHT:
          list = KNIGHT_T[s];
          for (i = 0; i < list.length; i++) if (b[list[i]] === 0) this._addMove(out, s, list[i], us, false, depth);
          break;
        case KING:
          list = KING_T[s];
          for (i = 0; i < list.length; i++) {
            if (this._canTake(list[i], us)) this._addMove(out, s, list[i], us, true, depth);
          }
          break;
        default: {
          var d0 = pc === BISHOP ? 4 : 0;
          var d1 = pc === ROOK ? 4 : 8;
          for (d = d0; d < d1; d++) {
            ray = RAYS[s * 8 + d];
            for (i = 0; i < ray.length; i++) {
              t = ray[i];
              a = b[t];
              if (a === 0) { this._addMove(out, s, t, us, false, depth); continue; }
              // only the queen may strike what stands in her way
              if (pc === QUEEN && this._canTake(t, us)) this._addMove(out, s, t, us, false, depth);
              break;
            }
          }
        }
      }
      // recall: send a weary comrade back to the reserve
      if (pc !== KING) {
        var keep = b[s];
        b[s] = 0;
        var safe = !this.attacked(this.kings[us === WHITE ? 0 : 1], -us);
        b[s] = keep;
        if (safe) {
          var rm = s | (s << 6) | RECALL;
          // stepping aside can uncover a check on the enemy king - that must not be mate either
          var eks = this.kings[us === WHITE ? 1 : 0];
          if (depth > 0 && eks >= 0) {
            b[s] = 0;
            var disc = this.attacked(eks, us);
            b[s] = keep;
            if (!disc || this._escapes(rm, depth - 1)) out.push(rm);
          } else out.push(rm);
        }
      }
      if (firstOnly && out.length) return out;
    }
    return out;
  };

  // ---- make / unmake ------------------------------------------------------------------
  Position.prototype._res = function (slot, delta) {
    var c = this.reserve[slot];
    this.hashLo ^= Z_RES_LO[slot * 10 + c]; this.hashHi ^= Z_RES_HI[slot * 10 + c];
    c += delta;
    this.reserve[slot] = c;
    this.hashLo ^= Z_RES_LO[slot * 10 + c]; this.hashHi ^= Z_RES_HI[slot * 10 + c];
  };

  Position.prototype._toggle = function (p, sq) {
    this.hashLo ^= Z_PIECE_LO[(p + 6) * 64 + sq];
    this.hashHi ^= Z_PIECE_HI[(p + 6) * 64 + sq];
  };

  Position.prototype.make = function (m) {
    var from = m & 63, to = (m >> 6) & 63, rally = (m >> 12) & 7;
    var b = this.board, us = this.side, n = this.sp;
    var ourBase = us === WHITE ? 0 : 6;
    this.uMove[n] = m;
    this.uHashLo[n] = this.hashLo;
    this.uHashHi[n] = this.hashHi;
    this.uClock[n] = this.clock;
    var pc = b[from];
    if (m & PASS) {
      this.uCap[n] = 0;
      this.clock++;
    } else if (m & RECALL) {
      this.uCap[n] = pc;
      b[from] = 0;
      this._toggle(pc, from);
      this._res(ourBase + slotFor(pc, from), 1);
      this.clock = 0;
    } else {
      var cap = b[to];
      this.uCap[n] = cap;
      if (cap !== 0) {
        this._toggle(cap, to);
        this._res((us === WHITE ? 6 : 0) + slotFor(cap, to), 1);
      }
      this._toggle(pc, from);
      b[from] = 0;
      b[to] = pc;
      this._toggle(pc, to);
      if (pc === us * KING) this.kings[us === WHITE ? 0 : 1] = to;
      if (rally !== 0) {
        var rp = us * rally;
        this._res(ourBase + slotFor(rp, from), -1);
        b[from] = rp;
        this._toggle(rp, from);
      }
      if (cap !== 0 || rally !== 0 || pc === us * PAWN || sealedAt(pc, to)) this.clock = 0;
      else this.clock++;
    }
    this.side = -us;
    this.hashLo ^= Z_SIDE_LO; this.hashHi ^= Z_SIDE_HI;
    this.ply++;
    this.sp = n + 1;
  };

  Position.prototype.unmake = function () {
    var n = --this.sp;
    var m = this.uMove[n], from = m & 63, to = (m >> 6) & 63, rally = (m >> 12) & 7;
    var b = this.board;
    this.side = -this.side;
    var us = this.side, ourBase = us === WHITE ? 0 : 6;
    if (m & PASS) {
      // nothing moved
    } else if (m & RECALL) {
      var rp0 = this.uCap[n];
      b[from] = rp0;
      this.reserve[ourBase + slotFor(rp0, from)]--;
    } else {
      if (rally !== 0) this.reserve[ourBase + slotFor(us * rally, from)]++;
      var pc = b[to], cap = this.uCap[n];
      b[from] = pc;
      b[to] = cap;
      if (cap !== 0) this.reserve[(us === WHITE ? 6 : 0) + slotFor(cap, to)]--;
      if (pc === us * KING) this.kings[us === WHITE ? 0 : 1] = from;
    }
    this.hashLo = this.uHashLo[n];
    this.hashHi = this.uHashHi[n];
    this.clock = this.uClock[n];
    this.ply--;
  };

  // ---- formation & outcome ----------------------------------------------------------------
  Position.prototype.formationScore = function (color) {
    var home = homeTable(color), b = this.board, n = 0;
    for (var s = 0; s < 64; s++) if (home[s] !== 0 && b[s] === color * home[s]) n++;
    return n;
  };

  // comrades (pawns, knights, bishops, rooks) standing on the board: 0 to 14.
  // This is the score of the Grand Revival ending.
  Position.prototype.revivedCount = function (color) {
    var b = this.board, n = 0, p;
    for (var s = 0; s < 64; s++) { p = b[s] * color; if (p > 0 && p < QUEEN) n++; }
    return n;
  };

  // the Grand Revival score: one point for every comrade risen onto the board, and one
  // more for every piece standing on its home square (so a sealed rook counts twice). 0 to 30.
  Position.prototype.revivalScore = function (color) {
    return this.revivedCount(color) + this.formationScore(color);
  };

  Position.prototype.formationComplete = function (color) {
    return this.formationScore(color) === 16;
  };

  Position.prototype.sealedCount = function (color) {
    var b = this.board, n = 0;
    for (var s = 0; s < 64; s++) if (b[s] * color > 0 && sealedAt(b[s], s)) n++;
    return n;
  };

  Position.prototype.piecesOnBoard = function (color) {
    var n = 0;
    for (var s = 0; s < 64; s++) if (this.board[s] * color > 0) n++;
    return n;
  };

  Position.prototype.repetitions = function () {
    var count = 0, n = this.sp;
    for (var i = n - 2; i >= 0 && i >= n - this.clock; i -= 2) {
      if (this.uHashLo[i] === this.hashLo && this.uHashHi[i] === this.hashHi) count++;
    }
    return count;
  };

  // outcome from the point of view of the position as it stands now
  Position.prototype.outcome = function () {
    var mover = -this.side;
    if (this.formationComplete(mover)) return { over: true, winner: mover, reason: 'matecheck' };
    if (this.formationComplete(this.side)) return { over: true, winner: this.side, reason: 'matecheck' };
    if (this.ply >= this.maxPly) {
      var w = this.formationScore(WHITE), bl = this.formationScore(BLACK);
      if (w === bl) {
        w = this.piecesOnBoard(WHITE); bl = this.piecesOnBoard(BLACK);
      }
      return { over: true, winner: w > bl ? WHITE : (bl > w ? BLACK : 0), reason: 'dawn' };
    }
    return { over: false, winner: 0, reason: '' };
  };

  // ---- describing moves -------------------------------------------------------------------
  function decode(m) {
    return {
      from: m & 63,
      to: (m >> 6) & 63,
      rally: (m >> 12) & 7,
      recall: (m & RECALL) !== 0,
      pass: (m & PASS) !== 0
    };
  }

  function encode(from, to, rally, recall) {
    if (recall) return from | (from << 6) | RECALL;
    return from | (to << 6) | ((rally || 0) << 12);
  }

  // full details of a legal move, read before it is played
  Position.prototype.describe = function (m) {
    var d = decode(m), b = this.board, us = this.side;
    if (d.pass) { d.piece = 0; d.color = us; d.captured = 0; d.seals = false; d.kingHome = d.queenHome = false; return d; }
    d.piece = b[d.from];
    d.color = us;
    d.captured = d.recall ? 0 : b[d.to];
    d.seals = !d.recall && sealedAt(d.piece, d.to);
    d.rallySeals = false;
    d.kingHome = !d.recall && d.piece === us * KING && homeTable(us)[d.to] === KING;
    d.queenHome = !d.recall && d.piece === us * QUEEN && homeTable(us)[d.to] === QUEEN;
    return d;
  };

  // a short readable notation: Qd2-c2, Nf3xe5, "Qd2-c2 ^N" when a knight rises, "@Bc4" for recall
  Position.prototype.notation = function (m) {
    var d = this.describe(m), t = Math.abs(d.piece), txt;
    if (d.pass) return 'pass';
    if (d.recall) {
      txt = '@' + LETTER[t] + sqName(d.from);
    } else {
      txt = (t === PAWN ? '' : LETTER[t]) + sqName(d.from) + (d.captured ? 'x' : '-') + sqName(d.to);
      if (d.rally) txt += ' ^' + LETTER[d.rally];
    }
    this.make(m);
    var oc = this.outcome();
    if (oc.over && oc.reason === 'matecheck') txt += ' *';
    else if (this.inCheck(this.side)) txt += '+';
    this.unmake();
    return txt;
  };

  // parse the notation above back into a move from the current position
  Position.prototype.parseMove = function (text) {
    var moves = this.legalMoves([]);
    var clean = String(text).replace(/[+#*]/g, '').trim();
    if (clean === 'pass') return moves[0] === PASS ? PASS : 0;
    for (var i = 0; i < moves.length; i++) {
      var n = this.notation(moves[i]).replace(/[+#*]/g, '').trim();
      if (n === clean) return moves[i];
    }
    return 0;
  };

  Position.prototype.homeSquares = function (color) {
    var home = homeTable(color), list = [];
    for (var s = 0; s < 64; s++) if (home[s]) list.push({ sq: s, type: home[s], filled: this.board[s] === color * home[s] });
    return list;
  };

  Position.prototype.reserveOf = function (color) {
    var base = color === WHITE ? 0 : 6, r = this.reserve;
    return {
      pawn: r[base + S_PAWN], knight: r[base + S_KNIGHT],
      lightBishop: r[base + S_LIGHT_B], darkBishop: r[base + S_DARK_B],
      rook: r[base + S_ROOK], queen: r[base + S_QUEEN],
      total: r[base] + r[base + 1] + r[base + 2] + r[base + 3] + r[base + 4] + r[base + 5]
    };
  };

  Position.prototype.history = function () {
    var list = [];
    for (var i = 0; i < this.sp; i++) list.push(this.uMove[i]);
    return list;
  };

  function newGame(battlefield, maxPly) {
    return new Position().setupBattlefield(battlefield || 'last-stand', maxPly);
  }

  return {
    WHITE: WHITE, BLACK: BLACK,
    PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK, QUEEN: QUEEN, KING: KING,
    RECALL: RECALL, PASS: PASS,
    DEFAULT_MAX_PLY: DEFAULT_MAX_PLY,
    LETTER: LETTER, NAMES: NAMES,
    BATTLEFIELDS: BATTLEFIELDS,
    HOME_W: HOME_W, HOME_B: HOME_B,
    KNIGHT_T: KNIGHT_T, KING_T: KING_T, RAYS: RAYS,
    Position: Position,
    newGame: newGame,
    sealedAt: sealedAt,
    inHomeRanks: inHomeRanks,
    inMuster: inMuster,
    homeTable: homeTable,
    isLight: isLight,
    fileOf: fileOf, rankOf: rankOf,
    sqName: sqName, parseSq: parseSq,
    decode: decode, encode: encode
  };
}));
