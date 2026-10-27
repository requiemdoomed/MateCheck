/*
 * MateCheck - the match
 * Copyright (c) 2026 Swayam Shakya. MIT License.
 *
 * Runs a game against the computer: turns, the computer's worker, panels, the move
 * log, undo, hints, saving, and the end-of-game ceremony. The tutorial borrows
 * the same board through "lesson mode".
 */
(function (root) {
  'use strict';

  var E = root.MateCheckEngine, B = root.MateCheckBrain, P = root.MateCheckPieces, S = root.MateCheckSound;
  var Board = root.MateCheckBoard;
  var WEIGHTS = root.MateCheckWeights || null;
  var NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  var LEVEL_NAMES = { beginner: 'Beginner-friendly', expert: 'Expert Courtroom' };
  // the journey: exploration music that keeps moving while you play, and a battle cue for tense moments
  var GAMEPLAY_TRACKS = ['play_voyage', 'play_caravan', 'play_forest', 'play_skyship', 'play_village', 'play_summit'];
  var BATTLE_TRACK = 'play_clash';
  var TRACK_TITLES = {
    play_voyage: 'The Open Sea', play_caravan: 'The Dune Road', play_forest: 'Rootlight Forest',
    play_skyship: 'Above the Clouds', play_village: 'The Hidden Village', play_summit: 'The Ebony Peaks',
    play_clash: 'Steel and Thunder', hall_theme: 'The Grand Hall', tutorial_theme: 'First Lessons'
  };
  // chess clocks: base minutes + increment seconds
  var CLOCKS = {
    none: null,
    '15+10': { base: 15 * 60000, inc: 10000, name: 'Rapid 15 + 10' },
    '10+0': { base: 10 * 60000, inc: 0, name: 'Rapid 10 + 0' },
    '5+3': { base: 5 * 60000, inc: 3000, name: 'Blitz 5 + 3' },
    '3+2': { base: 3 * 60000, inc: 2000, name: 'Blitz 3 + 2' }
  };
  // how a match is decided when nobody calls MateCheck
  var ENDINGS = {
    matecheck: { name: 'MateCheck at Dawn' },
    revival: { name: 'The Grand Revival' }
  };
  var TENSE_HOLD = 20000;
  function now() { return root.performance && performance.now ? performance.now() : Date.now(); }
  function fmtClock(ms) {
    ms = Math.max(0, ms);
    if (ms < 20000) return (Math.floor(ms / 100) / 10).toFixed(1);
    var t = Math.ceil(ms / 1000), m = Math.floor(t / 60), sec = t % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function $(id) { return document.getElementById(id); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function sideName(c) { return c === 1 ? 'White' : 'Black'; }

  // ---- the computer, preferably in a worker ------------------------------------------------
  function Opponent() {
    this.seq = 0;
    this.pending = {};
    this.worker = null;
    this.local = null;
    try {
      var src = [
        'var MateCheckEngine = (' + E.factory.toString() + ')();',
        'var brain = (' + B.factory.toString() + ')(MateCheckEngine, ' + JSON.stringify(WEIGHTS) + ');',
        'onmessage = function (e) {',
        '  var d = e.data;',
        '  try {',
        '    var pos = new MateCheckEngine.Position().load(d.start);',
        '    for (var i = 0; i < d.moves.length; i++) pos.make(d.moves[i]);',
        '    var r = brain.think(pos, d.opts);',
        '    postMessage({ id: d.id, move: r.move, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms });',
        '  } catch (err) { postMessage({ id: d.id, error: String(err && err.message || err) }); }',
        '};'
      ].join('\n');
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      var self = this;
      this.worker.onmessage = function (e) { self.resolve(e.data); };
      this.worker.onerror = function () { self.fallback(); };
    } catch (e) {
      this.fallback();
    }
  }

  Opponent.prototype.fallback = function () {
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignore */ } }
    this.worker = null;
    if (!this.local) this.local = B.factory(E, WEIGHTS);
    // re-run anything that was waiting on the dead worker
    var waiting = this.pending;
    this.pending = {};
    for (var id in waiting) if (Object.prototype.hasOwnProperty.call(waiting, id)) this.run(waiting[id]);
  };

  Opponent.prototype.ask = function (start, moves, opts) {
    var self = this;
    return new Promise(function (resolve) {
      var job = { id: ++self.seq, start: start, moves: moves, opts: opts, resolve: resolve };
      self.run(job);
    });
  };

  Opponent.prototype.run = function (job) {
    this.pending[job.id] = job;
    if (this.worker) {
      this.worker.postMessage({ id: job.id, start: job.start, moves: job.moves, opts: job.opts });
      return;
    }
    var self = this;
    setTimeout(function () {
      var pos = new E.Position().load(job.start);
      for (var i = 0; i < job.moves.length; i++) pos.make(job.moves[i]);
      var r = self.local.think(pos, job.opts);
      self.resolve({ id: job.id, move: r.move, score: r.score, depth: r.depth });
    }, 30);
  };

  Opponent.prototype.resolve = function (data) {
    var job = this.pending[data.id];
    if (!job) return;
    delete this.pending[data.id];
    job.resolve(data);
  };

  // ---- persistence ---------------------------------------------------------------------------
  var readPref = S.readPref, writePref = S.writePref;

  // ---- the game -------------------------------------------------------------------------------
  function Game() {
    var self = this;
    this.opponent = new Opponent();
    this.settings = readPref('settings', { level: 'beginner', side: 1, field: 'last-stand', clock: '10+0', ending: 'matecheck' });
    if (!(this.settings.clock in CLOCKS)) this.settings.clock = '10+0';
    if (!(this.settings.ending in ENDINGS)) this.settings.ending = 'matecheck';
    this.clock = null;
    this.tenseUntil = 0;
    this.view = readPref('view', { ghosts: true, coords: true, autoRally: false });
    this.mode = 'idle';
    this.pos = null;
    this.start = '';
    this.log = [];
    this.thinking = false;
    this.token = 0;
    this.over = null;
    this.stats = null;
    this.lesson = null;
    this.board = new Board($('board'), {
      interactive: true,
      onMove: function (m) { self.userMove(m); },
      onSelect: function (sq, list) { self.onSelect(sq, list); },
      pickRally: function (cands) { return self.bestRally(cands); },
      autoRally: function () { return self.view.autoRally; }
    });
    this.board.setOptions(this.view);
    this.bindUi();
    setInterval(function () { self.tick(); }, 100);
    document.addEventListener('visibilitychange', function () {
      // a casual game shouldn't be lost on time because the tab was in the background
      if (document.hidden) self.pauseClock();
      else self.resumeClock();
    });
  }

  Game.prototype.bindUi = function () {
    var self = this;
    $('newGameBtn').addEventListener('click', function () { self.openNewGame(); });
    $('undoBtn').addEventListener('click', function () { self.undo(); });
    $('hintBtn').addEventListener('click', function () { self.hint(); });
    $('rulesBtn').addEventListener('click', function () { self.openRules(); });
    $('resignBtn').addEventListener('click', function () {
      if (self.mode !== 'match' || self.over) return;
      $('resignDialog').showModal();
    });
    $('resignConfirm').addEventListener('click', function () {
      $('resignDialog').close();
      if (self.mode !== 'match' || self.over) return;
      self.token++;
      self.thinking = false;
      self.finish({ over: true, winner: -self.settings.side, reason: 'resign' });
    });
    S.on(function (type, name) {
      if (type !== 'music' || !TRACK_TITLES[name]) return;
      var np = $('nowPlaying');
      np.querySelector('span').textContent = TRACK_TITLES[name];
      np.classList.remove('show'); void np.offsetWidth; np.classList.add('show');
      np.classList.toggle('battle', name === BATTLE_TRACK);
    });
    $('settingsBtn').addEventListener('click', function () { self.openSettings(); });
    $('menuToggle').addEventListener('click', function () {
      var bar = this.closest('.bar-actions'), open = !bar.classList.contains('open');
      bar.classList.toggle('open', open);
      this.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      var bar = document.querySelector('.bar-actions.open');
      if (bar && !e.target.closest('.bar-actions')) { bar.classList.remove('open'); $('menuToggle').setAttribute('aria-expanded', 'false'); }
    });
    ['newGameBtn', 'rulesBtn', 'tutorialBtn', 'storyBtn', 'resignBtn'].forEach(function (id) { $(id).classList.add('collapsible'); });
    document.querySelectorAll('dialog [data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });
    document.querySelectorAll('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });
    // result dialog
    $('resultAgain').addEventListener('click', function () { $('resultDialog').close(); self.newMatch(self.settings); });
    $('resultSettings').addEventListener('click', function () { $('resultDialog').close(); self.openNewGame(); });
    $('resultReview').addEventListener('click', function () { $('resultDialog').close(); });
    // settings dialog
    var mv = $('musicVol'), sv = $('sfxVol');
    mv.value = Math.round(S.prefs.music * 100);
    sv.value = Math.round(S.prefs.sfx * 100);
    mv.addEventListener('input', function () { S.setMusicVolume(mv.value / 100); });
    sv.addEventListener('input', function () { S.setSfxVolume(sv.value / 100); });
    sv.addEventListener('change', function () { S.sfx('seal'); });
    $('muteAll').checked = !!S.prefs.muted;
    $('muteAll').addEventListener('change', function () { S.setMuted(this.checked); });
    $('showGhosts').checked = this.view.ghosts !== false;
    $('showCoords').checked = this.view.coords !== false;
    $('autoRally').checked = !!this.view.autoRally;
    $('showGhosts').addEventListener('change', function () { self.view.ghosts = this.checked; self.saveView(); });
    $('showCoords').addEventListener('change', function () { self.view.coords = this.checked; self.saveView(); });
    $('autoRally').addEventListener('change', function () { self.view.autoRally = this.checked; self.saveView(); });
    S.on(function (type, v) { if (type === 'muted') { $('settingsBtn').classList.toggle('muted', v); $('muteAll').checked = v; } });
    $('settingsBtn').classList.toggle('muted', !!S.prefs.muted);
    // new game dialog
    $('newGameForm').addEventListener('submit', function (e) {
      var btn = e.submitter;
      if (!btn || btn.value !== 'start') return;
      var f = new FormData(this);
      self.settings = { level: f.get('level'), side: +f.get('side'), field: f.get('field'), clock: f.get('clock') || 'none', ending: f.get('ending') || 'matecheck' };
      writePref('settings', self.settings);
      self.newMatch(self.settings);
    });
    // keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (self.mode !== 'match' || document.querySelector('dialog[open]')) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); self.undo(); }
      else if (e.key === 'h' || e.key === 'H') self.hint();
    });
  };

  Game.prototype.saveView = function () {
    writePref('view', this.view);
    this.board.setOptions(this.view);
  };

  // ---- starting things ---------------------------------------------------------------------------
  Game.prototype.newMatch = function (settings) {
    settings = settings || this.settings;
    this.settings = settings;
    this.mode = 'match';
    this.lesson = null;
    this.token++;
    this.thinking = false;
    this.over = null;
    this.asked = this.awaiting = -1;
    this.pos = E.newGame(settings.field);
    this.start = this.pos.toString();
    this.log = [];
    this.stats = { 1: { rallies: 0, banished: 0, recalls: 0, seals: 0 }, '-1': { rallies: 0, banished: 0, recalls: 0, seals: 0 }, takebacks: 0, hints: 0 };
    this.board.userSide = settings.side;
    this.board.setFlipped(settings.side === -1);
    this.board.lastMove = null;
    this.board.showHint(0);
    this.board.setPosition(this.pos);
    this.initClock(settings.clock, null);
    this.revivalPly = -1; this.revivalPrev = {}; this.revivalNow = {};
    this.tenseUntil = 0;
    this.calmUntil = now() + 30000;
    $('matchLabel').textContent = this.matchLabel(settings);
    this.renderAll();
    this.save();
    S.playlist(GAMEPLAY_TRACKS, { battle: BATTLE_TRACK, stay: 60 });
    if (settings.ending === 'revival') this.status('The Grand Revival: raise every comrade and bring them home. When time runs out, the bigger revival wins.');
    else this.status(settings.side === 1 ? 'Your move. Step off your muster ground and let a comrade rise.' : 'The computer opens the game.');
    this.next();
  };

  Game.prototype.resume = function () {
    var s = readPref('save', null);
    if (!s || !s.start) return false;
    try {
      var pos = new E.Position().load(s.start);
      var log = [];
      for (var i = 0; i < s.moves.length; i++) {
        var legal = pos.legalMoves([]);
        if (legal.indexOf(s.moves[i]) < 0) throw new Error('bad save');
        log.push(this.entry(pos, s.moves[i]));
        pos.make(s.moves[i]);
      }
      this.settings = s.settings;
      if (!(this.settings.clock in CLOCKS)) this.settings.clock = 'none';
      if (!(this.settings.ending in ENDINGS)) this.settings.ending = 'matecheck';
      this.mode = 'match';
      this.lesson = null;
      this.token++;
      this.thinking = false;
      this.over = null;
      this.asked = this.awaiting = -1;
      this.pos = pos;
      this.start = s.start;
      this.log = log;
      this.stats = s.stats;
      this.board.userSide = s.settings.side;
      this.board.setFlipped(s.settings.side === -1);
      this.board.showHint(0);
      this.board.setPosition(pos);
      this.initClock(this.settings.clock, s.clock);
      this.tenseUntil = 0;
      this.calmUntil = now() + 30000;
      $('matchLabel').textContent = this.matchLabel(this.settings);
      this.renderAll();
      S.playlist(GAMEPLAY_TRACKS, { battle: BATTLE_TRACK, stay: 60 });
      this.status('Welcome back. The match is where you left it.');
      this.next();
      return true;
    } catch (e) {
      writePref('save', null);
      return false;
    }
  };

  Game.prototype.hasSave = function () {
    var s = readPref('save', null);
    return !!(s && s.start && s.moves && s.moves.length);
  };

  Game.prototype.save = function () {
    if (this.mode !== 'match') return;
    if (this.over) { writePref('save', null); return; }
    var c = this.clock;
    writePref('save', { v: 2, start: this.start, moves: this.pos.history(), settings: this.settings, stats: this.stats,
      clock: c ? { left: { 1: this.remaining(1), '-1': this.remaining(-1) }, hist: c.hist } : null });
  };

  Game.prototype.matchLabel = function (st) {
    var c = CLOCKS[st.clock];
    return (E.BATTLEFIELDS[st.field] || {}).name + ', against ' + LEVEL_NAMES[st.level] +
      (st.ending === 'revival' ? ' \u00b7 Grand Revival' : '') + (c ? ' \u00b7 ' + c.name : '');
  };

  // ---- the chess clock ---------------------------------------------------------------------------
  Game.prototype.initClock = function (kind, saved) {
    var preset = CLOCKS[kind];
    if (!preset) { this.clock = null; return; }
    var n = this.pos.history().length;
    this.clock = { base: preset.base, inc: preset.inc, left: { 1: preset.base, '-1': preset.base }, side: 0, since: 0, paused: 0, hist: [], warned: 99 };
    if (saved && saved.left) {
      this.clock.left = { 1: +saved.left[1], '-1': +saved.left['-1'] };
      this.clock.hist = Array.isArray(saved.hist) ? saved.hist.slice(0, n + 1) : [];
    }
    if (!this.clock.hist.length) this.clock.hist[0] = { 1: preset.base, '-1': preset.base };
    this.clock.hist[n] = { 1: this.clock.left[1], '-1': this.clock.left['-1'] };
  };

  Game.prototype.remaining = function (side) {
    var c = this.clock;
    if (!c) return Infinity;
    return c.left[side] - (c.side === side ? now() - c.since : 0);
  };

  Game.prototype.runClock = function (side) {
    var c = this.clock;
    if (!c || this.over || this.mode !== 'match') return;
    if (document.hidden) { c.paused = side; return; }
    c.side = side;
    c.since = now();
    c.warned = 99;
  };

  Game.prototype.stopClock = function () {
    var c = this.clock;
    if (!c || !c.side) return;
    c.left[c.side] -= now() - c.since;
    c.side = 0;
  };

  // the mover hits the clock: time used is charged, the increment is added, and a snapshot is kept for undo
  Game.prototype.punchClock = function (mover) {
    var c = this.clock;
    if (!c) return;
    this.stopClock();
    c.paused = 0;
    c.left[mover] += c.inc;
    c.hist[this.pos.history().length] = { 1: c.left[1], '-1': c.left['-1'] };
  };

  Game.prototype.pauseClock = function () {
    var c = this.clock;
    if (!c || !c.side) return;
    var side = c.side;
    this.stopClock();
    c.paused = side;
    this.save();
  };

  Game.prototype.resumeClock = function () {
    var c = this.clock;
    if (!c || !c.paused || this.over || this.mode !== 'match') return;
    var side = c.paused;
    c.paused = 0;
    if (this.pos.side === side) this.runClock(side);
  };

  Game.prototype.tick = function () {
    var c = this.clock;
    if (this.mode === 'match' && !this.over) {
      if (this.tenseUntil && now() > this.tenseUntil && !this.isTense()) { this.tenseUntil = 0; this.calmUntil = now() + 45000; S.setTension(false); }
    }
    if (!c || this.mode !== 'match') return;
    var me = this.settings.side;
    [1, -1].forEach(function (side) {
      var faces = document.querySelectorAll('.clock-face[data-side="' + side + '"]');
      var left = this.remaining(side);
      for (var k = 0; k < faces.length; k++) this.paintFace(faces[k], side, left);
    }, this);
    if (!c.side || this.over) return;
    var left = this.remaining(c.side);
    if (c.side === me && left < 10000) {
      var whole = Math.ceil(left / 1000);
      if (whole < c.warned) { c.warned = whole; S.sfx('tick'); }
    }
    if (c.side === me && left < 30000 && !this.tenseUntil) this.tense();
    if (left <= 0) this.flag(c.side);
  };

  Game.prototype.paintFace = function (face, side, left) {
    var c = this.clock;
    face.querySelector('.clock-time').textContent = fmtClock(left);
    face.classList.toggle('running', c.side === side);
    face.classList.toggle('low', left < 30000);
    face.classList.toggle('critical', left < 10000);
    var bar = face.querySelector('.clock-bar i');
    if (bar) bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / c.base)).toFixed(3) + ')';
  };

  Game.prototype.clockHtml = function (color, label) {
    return '<div class="clock-face" data-side="' + color + '" role="timer" aria-label="' + label + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>' +
      '<span class="clock-time">' + fmtClock(this.remaining(color)) + '</span><span class="clock-bar"><i></i></span></div>';
  };

  Game.prototype.flag = function (side) {
    var c = this.clock;
    this.stopClock();
    c.left[side] = 0;
    this.token++;
    this.thinking = false;
    this.awaiting = -1;
    if (this.settings.ending === 'revival') this.finish(this.judgeRevival(side));
    else this.finish({ over: true, winner: -side, reason: 'time' });
  };

  // ---- the Grand Revival ---------------------------------------------------------------------------
  // When time runs out (or dawn breaks) the revival is counted: one point for every comrade risen
  // onto the board, one more for every piece standing home. Level scores go to the army with more
  // pieces home; still level, a fallen flag decides, otherwise it is a draw.
  Game.prototype.judgeRevival = function (flagged) {
    var pos = this.pos, w = pos.revivalScore(1), b = pos.revivalScore(-1), tie = '';
    var winner = w > b ? 1 : (b > w ? -1 : 0);
    if (!winner) {
      w = pos.formationScore(1); b = pos.formationScore(-1);
      winner = w > b ? 1 : (b > w ? -1 : 0);
      if (winner) tie = 'home';
    }
    if (!winner && flagged) { winner = -flagged; tie = 'clock'; }
    return { over: true, winner: winner, reason: 'revival', flagged: flagged || 0, tie: tie };
  };

  // the computer cares more about the count as the clock runs down
  Game.prototype.reviveWeight = function () {
    if (this.settings.ending !== 'revival') return 0;
    var pressure = this.clock && Math.min(this.remaining(1), this.remaining(-1)) < 60000;
    var late = this.pos.ply >= 160;
    return pressure || late ? 40 : 15;
  };

  // ---- music that follows the game -------------------------------------------------------------------
  // a check is a passing storm: it only calls the battle cue if the music has been calm for a while.
  // A close finish, dawn on the horizon or a low clock always does.
  Game.prototype.isTense = function () {
    var pos = this.pos;
    if (!pos || this.over) return false;
    if ((pos.inCheck(1) || pos.inCheck(-1)) && (this.tenseUntil || now() > (this.calmUntil || 0))) return true;
    if (pos.ply >= 170) return true;                                   // dawn is close
    if (pos.formationScore(1) >= 13 || pos.formationScore(-1) >= 13) return true;   // someone is nearly home
    if (this.clock && this.remaining(this.settings.side) < 30000) return true;
    return false;
  };

  Game.prototype.tense = function () {
    if (!this.tenseUntil) S.setTension(true);
    this.tenseUntil = now() + TENSE_HOLD;
  };

  // ---- turn flow ---------------------------------------------------------------------------------
  Game.prototype.next = function () {
    var self = this;
    if (this.mode !== 'match' || this.over) return;
    var oc = this.pos.outcome();
    if (oc.over && oc.reason === 'dawn' && this.settings.ending === 'revival') oc = this.judgeRevival(0);
    if (oc.over) { this.finish(oc); return; }
    var legal = this.pos.legalMoves([]);
    var myTurn = this.pos.side === this.settings.side;
    this.renderPanels();
    if (this.isTense()) this.tense();
    if (!this.clock || this.clock.side !== this.pos.side) this.runClock(this.pos.side);
    if (myTurn) {
      this.awaiting = this.pos.ply;               // the only moment a move from you is accepted
      this.board.setLegal(legal, true);
      this.renderActions(legal);
      if (legal.length === 1 && legal[0] === E.PASS) this.status('You have no legal move, so your turn passes.', 'check');
      else if (this.pos.inCheck(this.pos.side)) { this.status('Check! Get your king out of the queen\'s line.', 'check'); }
      S.sfx('turn');
    } else {
      if (this.asked === this.pos.ply) return;     // already thinking about this very turn
      this.asked = this.pos.ply;
      this.awaiting = -1;
      this.board.setLegal([], false);
      this.renderActions([]);
      this.thinking = true;
      this.renderPanels();
      var token = this.token, started = Date.now(), askedAt = this.pos.ply;
      var lvl = this.settings.level;
      this.opponent.ask(this.start, this.pos.history(), { level: lvl, seed: (Date.now() ^ (this.pos.ply * 2654435761)) >>> 0, ending: this.settings.ending, revive: this.reviveWeight() }).then(function (r) {
        if (token !== self.token || self.mode !== 'match' || self.pos.ply !== askedAt) return;
        var wait = Math.max(0, (lvl === 'beginner' ? 700 : 450) - (Date.now() - started));
        setTimeout(function () {
          if (token !== self.token || self.pos.ply !== askedAt || self.over) return;
          self.thinking = false;
          var legalNow = self.pos.legalMoves([]);
          var m = r && !r.error && legalNow.indexOf(r.move) >= 0 ? r.move : legalNow[0];
          self.play(m, false);
        }, wait);
      });
    }
  };

  Game.prototype.userMove = function (m) {
    if (this.mode === 'lesson') { this.lessonMove(m); return; }
    if (this.mode !== 'match' || this.over || this.thinking || this.pos.side !== this.settings.side) return;
    if (this.awaiting !== this.pos.ply) return;       // the last move is still landing
    if (this.pos.outcome().over) return;
    if (this.pos.legalMoves([]).indexOf(m) < 0) return;
    this.board.showHint(0);
    this.play(m, true);
  };

  Game.prototype.play = function (m, byUser) {
    var self = this, pos = this.pos;
    this.awaiting = -1;
    var d = pos.describe(m);
    var entry = this.entry(pos, m);
    var mover = pos.side;
    pos.make(m);
    this.punchClock(mover);
    this.log.push(entry);
    var st = this.stats[mover];
    if (d.rally) st.rallies++;
    if (d.captured) st.banished++;
    if (d.recall) st.recalls++;
    if (d.seals) st.seals++;
    var wait = this.board.playMove(d, pos);
    this.sounds(d, pos);
    this.renderLog();
    this.renderPanels(d);
    this.save();
    if (!byUser) this.status(this.describeMove(d, mover));
    else this.status(d.seals ? 'Sealed. That ' + NAMES[Math.abs(d.piece)] + ' is home for good.' : '', d.seals ? 'good' : '');
    setTimeout(function () { self.next(); }, Math.min(wait, 380));
  };

  Game.prototype.sounds = function (d, pos) {
    if (d.pass) return;
    if (d.recall) S.sfx('recall');
    else if (d.captured) S.sfx('banish');
    else S.sfx('move');
    if (d.rally) setTimeout(function () { S.sfx('rally'); }, 120);
    if (d.seals) setTimeout(function () { S.sfx('seal'); }, 280);
    if (pos.inCheck(pos.side)) setTimeout(function () { S.sfx('check'); }, 200);
  };

  Game.prototype.describeMove = function (d, mover) {
    if (d.pass) return sideName(mover) + ' has no legal move and passes.';
    var who = mover === this.settings.side ? 'You' : 'The computer';
    var piece = NAMES[Math.abs(d.piece)];
    if (d.recall) return who + ' recalled the ' + piece + ' from ' + E.sqName(d.from) + '.';
    var txt = who + ' moved the ' + piece + ' to ' + E.sqName(d.to);
    if (d.captured) txt += ', banishing ' + (mover === this.settings.side ? 'its' : 'your') + ' ' + NAMES[Math.abs(d.captured)];
    if (d.rally) txt += ', and a ' + NAMES[d.rally] + ' rose on ' + E.sqName(d.from);
    if (d.seals) txt += '. It is sealed at home';
    txt += '.';
    if (this.pos.inCheck(this.pos.side)) txt += ' Check!';
    return txt;
  };

  // pick the rally a sensible player would usually want: the piece that ends up closest to home
  Game.prototype.bestRally = function (cands) {
    var best = cands[0], bestScore = -1e9, pos = this.pos;
    for (var i = 0; i < cands.length; i++) {
      var r = (cands[i] >> 12) & 7;
      if (!r) continue;
      var d = E.decode(cands[i]);
      var sc = r === 5 ? 100 : 0;
      var homes = pos.homeSquares(pos.side).filter(function (h) { return h.type === r && !h.filled; });
      var dist = 9;
      homes.forEach(function (h) {
        var df = Math.abs((h.sq & 7) - (d.from & 7)), dr = Math.abs((h.sq >> 3) - (d.from >> 3));
        dist = Math.min(dist, Math.max(df, dr));
      });
      sc += 20 - dist * 3 + (r === 1 ? 2 : 0);
      if (sc > bestScore) { bestScore = sc; best = cands[i]; }
    }
    return best;
  };

  // ---- undo / hint ----------------------------------------------------------------------------------
  Game.prototype.undo = function () {
    if (this.mode === 'lesson') { if (this.lesson) this.lesson.reset(); return; }
    if (this.mode !== 'match') return;
    var me = this.settings.side, pos = this.pos;
    if (pos.sp === 0) { this.toast('Nothing to take back yet.'); return; }
    this.token++;
    this.thinking = false;
    this.asked = this.awaiting = -1;
    if (this.over) this.over = null;
    var undone = 0;
    // step back to the last position where it was your turn, undoing at least one of your moves
    do {
      pos.unmake();
      this.log.pop();
      undone++;
    } while (pos.sp > 0 && (pos.side !== me || undone < 1));
    this.stats.takebacks++;
    this.recountStats();
    if (this.clock) {
      var c = this.clock, n = pos.history().length;
      c.side = 0;
      c.paused = 0;
      c.hist.length = n + 1;
      var snap = c.hist[n] || { 1: c.base, '-1': c.base };
      c.left = { 1: snap[1], '-1': snap['-1'] };
    }
    this.board.lastMove = null;
    this.board.showHint(0);
    this.board.setPosition(pos);
    this.renderLog();
    this.save();
    this.status('Move taken back.');
    S.sfx('recall');
    this.next();
  };

  Game.prototype.recountStats = function () {
    var probe = new E.Position().load(this.start), moves = this.pos.history();
    var st = { 1: { rallies: 0, banished: 0, recalls: 0, seals: 0 }, '-1': { rallies: 0, banished: 0, recalls: 0, seals: 0 } };
    for (var i = 0; i < moves.length; i++) {
      var d = probe.describe(moves[i]), s = st[probe.side];
      if (d.rally) s.rallies++;
      if (d.captured) s.banished++;
      if (d.recall) s.recalls++;
      if (d.seals) s.seals++;
      probe.make(moves[i]);
    }
    st.takebacks = this.stats.takebacks;
    st.hints = this.stats.hints;
    this.stats = st;
  };

  Game.prototype.hint = function () {
    var self = this;
    if (this.mode !== 'match' || this.over || this.thinking || this.pos.side !== this.settings.side) return;
    var token = this.token;
    this.status('Consulting the royal advisers...');
    $('hintBtn').disabled = true;
    this.opponent.ask(this.start, this.pos.history(), { level: 'expert', timeMs: 900, noise: 0, ending: this.settings.ending, revive: this.reviveWeight() }).then(function (r) {
      $('hintBtn').disabled = false;
      if (token !== self.token || !r || !r.move) return;
      self.stats.hints++;
      self.board.showHint(r.move);
      S.sfx('hint');
      self.status('Hint: ' + self.prettyNotation(self.pos.notation(r.move)) + '.');
    });
  };

  // ---- the end -----------------------------------------------------------------------------------------
  Game.prototype.finish = function (oc) {
    var self = this;
    this.stopClock();
    this.over = oc;
    this.board.setLegal([], false);
    this.renderActions([]);
    this.renderPanels();
    writePref('save', null);
    var me = this.settings.side, won = oc.winner === me, lost = oc.winner === -me;
    var wf = this.pos.formationScore(me), tf = this.pos.formationScore(-me);
    var kicker, title, text;
    if (oc.reason === 'matecheck') {
      kicker = won ? 'MateCheck!' : 'MateCheck for the computer';
      title = won ? 'Your army stands complete' : 'The court is back in line';
      text = won ? 'Every one of your sixteen pieces is home on its starting square. The lonely king finally has his army back.'
        : 'The computer stood its whole army home first. Next time, seal your back rank earlier and keep a gate open for your royals.';
    } else if (oc.reason === 'time') {
      kicker = 'The flag falls';
      title = won ? 'The computer ran out of time' : 'Your time ran out';
      text = (won ? 'Its clock hit zero first. ' : 'Your clock hit zero first. ') + 'Pieces home when time ran out: you ' + wf + ', the computer ' + tf + '.';
    } else if (oc.reason === 'revival') {
      var ws = this.pos.revivalScore(me), ts = this.pos.revivalScore(-me);
      kicker = oc.flagged ? (oc.flagged === me ? 'Your clock ran out. The revival is counted' : 'The computer\'s clock ran out. The revival is counted')
        : 'Dawn breaks. The revival is counted';
      title = won ? 'Your revival was greater' : (lost ? 'The computer revived more' : 'An even revival');
      text = 'Revival score (comrades risen + pieces home): you ' + ws + ', the computer ' + ts + '.';
      if (oc.tie === 'home') text += ' Level on score, so pieces home decided it: you ' + wf + ', the computer ' + tf + '.';
      else if (oc.tie === 'clock') text += ' Level on everything, so the army with time left on its clock takes it.';
      else if (!oc.winner) text += ' Level on score and on pieces home.';
    } else if (oc.reason === 'resign') {
      kicker = 'You laid down your crown';
      title = 'The computer takes this one';
      text = 'Resigning is no shame. Even the lonely king played again the next morning. Pieces home: you ' + wf + ', the computer ' + tf + '.';
    } else if (oc.reason === 'dawn') {
      kicker = 'Dawn breaks after 100 moves';
      title = won ? 'Victory at dawn' : (lost ? 'Defeat at dawn' : 'A draw at dawn');
      text = 'Pieces home at sunrise: you ' + wf + ', the computer ' + tf + '.';
    } else {
      kicker = 'No legal moves for either army';
      title = 'A quiet draw';
      text = 'The realm has nothing left to do.';
    }
    $('resultKicker').textContent = kicker;
    $('resultTitle').textContent = title;
    $('resultText').textContent = text;
    var st = this.stats[me];
    $('resultStats').innerHTML =
      (this.settings.ending === 'revival'
        ? '<div><dt>Revival score</dt><dd>' + this.pos.revivalScore(me) + ' / 30</dd></div>'
        : '<div><dt>Your moves</dt><dd>' + this.log.filter(function (e) { return e.side === me; }).length + '</dd></div>') +
      '<div><dt>Comrades rallied</dt><dd>' + st.rallies + '</dd></div>' +
      '<div><dt>Pieces home</dt><dd>' + wf + ' / 16</dd></div>';
    this.status(title + '.', won ? 'good' : (lost ? 'check' : ''));
    S.stopMusic(1.5);
    if (won) { this.board.wave(); S.sting('victory'); }
    else if (lost) S.sting('defeat');
    else S.sting('cliff_hit', { gain: 0.6 });
    setTimeout(function () {
      if (self.over === oc) $('resultDialog').showModal();
      S.music('hall_theme', { fade: 3 });
    }, won ? 2200 : 1600);
  };

  // ---- rendering ---------------------------------------------------------------------------------------
  Game.prototype.status = function (text, kind) {
    var s = $('statusLine');
    s.textContent = text || '';
    s.className = 'status-line' + (kind ? ' ' + kind : '');
  };

  Game.prototype.toast = function (text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  };

  Game.prototype.renderAll = function () {
    this.renderPanels();
    this.renderLog();
    this.renderActions([]);
  };

  Game.prototype.panelHtml = function (color, isMe) {
    var pos = this.pos;
    var lvl = this.settings.level;
    var active = !this.over && pos.side === color;
    var name = isMe ? 'You' : 'The computer';
    var sub = sideName(color) + (isMe ? '' : ', ' + LEVEL_NAMES[lvl]);
    if (this.mode === 'lesson') { name = isMe ? 'You' : 'A sleepy opponent'; sub = sideName(color); }
    var html = '<div class="panel compactable' + (active ? ' active' : '') + (active && !isMe && this.thinking ? ' thinking-now' : '') + '">';
    html += '<div class="panel-head"><div class="avatar ' + (color === 1 ? 'white' : 'black') + '">' + P.svg(6, color) + '</div>' +
      '<div class="who"><b>' + name + '</b><small>' + sub + '</small> <span class="thinking" aria-label="thinking"><i></i><i></i><i></i></span></div>' +
      '<span class="turn-dot" aria-hidden="true"></span></div>' +
      (this.clock && this.mode === 'match' ? this.clockHtml(color, isMe ? 'Your clock' : 'Computer clock') : '');
    // formation map, drawn the way that army sees its own home rows on screen
    var homes = pos.homeSquares(color), filled = 0;
    homes.forEach(function (h) { if (h.filled) filled++; });
    var rows = color === 1 ? [[8, 15], [0, 7]] : [[56, 63], [48, 55]];
    if (this.board.flipped) rows = color === 1 ? [[0, 7], [8, 15]] : [[48, 55], [56, 63]];
    var cells = '';
    for (var r = 0; r < 2; r++) {
      for (var i = 0; i < 8; i++) {
        var f = this.board.flipped ? 7 - i : i;
        var sq = rows[r][0] + f;
        var home = color === 1 ? E.HOME_W[sq] : E.HOME_B[sq];
        var isFilled = pos.board[sq] === color * home;
        cells += '<span class="fm-cell' + (isFilled ? ' filled' : '') + '" data-sq="' + sq + '" title="' + E.sqName(sq) + '">' + P.svg(home, color) + '</span>';
      }
    }
    if (this.mode === 'match' && this.settings.ending === 'revival') html += this.revivalHtml(color);
    html += '<div class="formation"><div class="formation-top"><span>Pieces home</span><b>' + filled + ' / 16</b></div><div class="formation-map">' + cells + '</div></div>';
    // the reserve
    var res = pos.reserveOf(color);
    var slots = [['pawn', 1, ''], ['knight', 2, ''], ['lightBishop', 3, 'bl'], ['darkBishop', 3, 'bd'], ['rook', 4, ''], ['queen', 5, '']];
    var tray = '';
    slots.forEach(function (s) {
      var n = res[s[0]];
      if (!n) return;
      var label = s[0] === 'lightBishop' ? 'light-square bishop' : (s[0] === 'darkBishop' ? 'dark-square bishop' : s[0]);
      tray += '<span class="rs ' + s[2] + '" title="' + n + ' ' + label + (n > 1 ? 's' : '') + ' waiting">' + P.svg(s[1], color) + (n > 1 ? '<b>' + n + '</b>' : '') + '</span>';
    });
    html += '<div class="reserve"><div class="reserve-title"><span>In the reserve</span><span>' + res.total + '</span></div><div class="reserve-tray">' +
      (tray || '<span class="reserve-empty">Everyone has risen.</span>') + '</div></div>';
    html += '</div>';
    return html;
  };

  Game.prototype.revivalHtml = function (color) {
    var pos = this.pos, risen = pos.revivedCount(color), home = pos.formationScore(color), score = risen + home;
    var other = pos.revivalScore(-color);
    // compare with the score before the last move, so a rise or a loss can be flashed
    if (this.revivalPly !== pos.ply) { this.revivalPrev = this.revivalNow || {}; this.revivalNow = {}; this.revivalPly = pos.ply; }
    this.revivalNow[color] = score;
    var prev = this.revivalPrev[color];
    var cls = 'revival' + (score > other ? ' leading' : '') + (prev != null && score > prev ? ' up' : (prev != null && score < prev ? ' down' : ''));
    return '<div class="' + cls + '" title="Grand Revival score: comrades risen plus pieces home">' +
      '<div class="revival-top"><span>Revival</span><b>' + score + ' / 30</b></div>' +
      '<div class="revival-bar"><i class="risen" style="width:' + (risen / 30 * 100).toFixed(1) + '%"></i><i class="home" style="width:' + (home / 30 * 100).toFixed(1) + '%"></i></div>' +
      '<small><span class="k-risen">' + risen + ' risen</span> \u00b7 <span class="k-home">' + home + ' home</span>' + (score > other ? ' \u00b7 <b>leading</b>' : '') + '</small></div>';
  };

  Game.prototype.renderPanels = function (lastDesc) {
    if (!this.pos) return;
    var me = this.mode === 'lesson' ? 1 : this.settings.side;
    $('panelPlayer').innerHTML = this.panelHtml(me, true);
    $('panelOpponent').innerHTML = this.panelHtml(-me, false);
    // on phones your own panel sits below the fold, so your clock is repeated under the board
    var mc = $('mobileClock'), want = this.clock && this.mode === 'match';
    if (!want) mc.innerHTML = '';
    else if (!mc.firstChild) mc.innerHTML = this.clockHtml(me, 'Your clock');
    else mc.firstChild.dataset.side = String(me);
    $('mobileRevival').innerHTML = this.mode === 'match' && this.settings.ending === 'revival' ? this.revivalHtml(me) : '';
    if (lastDesc && lastDesc.seals) {
      var cell = document.querySelector('.fm-cell[data-sq="' + lastDesc.to + '"]');
      if (cell) { cell.classList.add('pop'); setTimeout(function () { cell.classList.remove('pop'); }, 450); }
    }
  };

  Game.prototype.entry = function (pos, m) {
    return { text: pos.notation(m), d: pos.describe(m), side: pos.side };
  };

  Game.prototype.prettyNotation = function (t) {
    return t.replace(' ^', ' rally ').replace('@', 'recall ').replace(' *', ' MateCheck');
  };

  Game.prototype.renderLog = function () {
    var ol = $('moveLog');
    var html = '', first = this.start ? (new E.Position().load(this.start)).side : 1;
    var list = this.log.slice();
    if (first === -1) list.unshift(null);
    for (var i = 0; i < list.length; i += 2) {
      html += '<li><span class="n">' + (i / 2 + 1) + '.</span>' + this.logCell(list[i], i === list.length - 1) + this.logCell(list[i + 1], i + 1 === list.length - 1) + '</li>';
    }
    ol.innerHTML = html;
    ol.scrollTop = ol.scrollHeight;
  };

  Game.prototype.logCell = function (e, last) {
    if (!e) return '<span class="mv"></span>';
    var t = e.text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    t = t.replace(/ \^([PNBRQ])/, ' <span class="r">↑$1</span>').replace(/x/, '<span class="x">x</span>').replace(/^@/, '<span class="r">↺</span>').replace(' *', ' <span class="s">★</span>');
    if (e.d.seals) t += ' <span class="s" title="sealed">◆</span>';
    return '<span class="mv' + (last ? ' last' : '') + '">' + t + '</span>';
  };

  Game.prototype.renderActions = function (legal) {
    var row = $('actionRow'), self = this;
    row.innerHTML = '';
    if (legal.length === 1 && legal[0] === E.PASS) {
      var b = document.createElement('button');
      b.className = 'action-btn';
      b.textContent = 'Pass the turn';
      b.addEventListener('click', function () { self.userMove(E.PASS); });
      row.appendChild(b);
    }
  };

  Game.prototype.onSelect = function (sq, list) {
    var row = $('actionRow'), self = this;
    if (this.mode !== 'match' && this.mode !== 'lesson') return;
    var old = row.querySelector('.recall-btn');
    if (old) old.remove();
    if (sq < 0) return;
    var rec = list.filter(function (m) { return (m & E.RECALL) !== 0; })[0];
    if (!rec) return;
    var b = document.createElement('button');
    b.className = 'action-btn warn recall-btn';
    b.textContent = 'Recall this ' + NAMES[Math.abs(this.pos.board[sq])] + ' to the reserve';
    b.addEventListener('click', function () { self.board.clearSelection(); self.userMove(rec); });
    row.appendChild(b);
  };

  // ---- dialogs -----------------------------------------------------------------------------------
  Game.prototype.openNewGame = function () {
    var s = this.settings, form = $('newGameForm');
    form.querySelector('input[name="level"][value="' + s.level + '"]').checked = true;
    form.querySelector('input[name="side"][value="' + s.side + '"]').checked = true;
    var ck = form.querySelector('input[name="clock"][value="' + (s.clock || 'none') + '"]');
    if (ck) ck.checked = true;
    var en = form.querySelector('input[name="ending"][value="' + (s.ending || 'matecheck') + '"]');
    if (en) en.checked = true;
    var list = $('fieldList'), html = '';
    Object.keys(E.BATTLEFIELDS).forEach(function (id) {
      var bf = E.BATTLEFIELDS[id];
      html += '<label class="choice field-choice"><input type="radio" name="field" value="' + id + '"' + (id === s.field ? ' checked' : '') + '>' +
        '<span><b>' + bf.name + '</b><small>' + bf.blurb + '</small></span>' + miniBoard(bf) + '</label>';
    });
    list.innerHTML = html;
    $('newGameDialog').showModal();
  };

  function miniBoard(bf) {
    var cells = '';
    var pieces = {};
    pieces[bf.white.K] = [6, 1]; pieces[bf.white.Q] = [5, 1]; pieces[bf.black.K] = [6, -1]; pieces[bf.black.Q] = [5, -1];
    for (var r = 7; r >= 0; r--) {
      for (var f = 0; f < 8; f++) {
        var name = 'abcdefgh'[f] + (r + 1), p = pieces[name];
        var fill = ((f + r) & 1) ? '#e7d8f4' : '#7b4cb2';
        cells += '<rect x="' + f + '" y="' + (7 - r) + '" width="1" height="1" fill="' + fill + '"/>';
        if (p) cells += '<circle cx="' + (f + 0.5) + '" cy="' + (7.5 - r) + '" r="0.36" fill="' + (p[1] > 0 ? '#fff3dc' : '#2a1340') + '" stroke="' + (p[1] > 0 ? '#2a0e44' : '#f6c453') + '" stroke-width="0.1"/>' +
          '<text x="' + (f + 0.5) + '" y="' + (7.64 - r) + '" font-size="0.42" text-anchor="middle" font-weight="700" fill="' + (p[1] > 0 ? '#2a0e44' : '#f6c453') + '">' + (p[0] === 6 ? 'K' : 'Q') + '</text>';
      }
    }
    return '<svg class="mini" viewBox="0 0 8 8" aria-hidden="true">' + cells + '</svg>';
  }

  Game.prototype.openRules = function () {
    $('rulesBody').innerHTML = RULES.map(function (r) { return '<section><h3>' + r[0] + '</h3><p>' + r[1] + '</p></section>'; }).join('');
    $('rulesDialog').showModal();
  };

  Game.prototype.openSettings = function () { $('settingsDialog').showModal(); };

  var RULES = [
    ['The goal', 'Be the first to have all sixteen of your pieces standing on their classic starting squares. That is MateCheck, and it wins on the spot.'],
    ['The start', 'Each side begins with only a king and a queen. Pawns, knights, bishops and rooks wait in the reserve.'],
    ['Rally', 'When one of your pieces leaves a square on your muster ground (ranks 3 and 4 for White, 6 and 5 for Black), you may raise one reserve piece on the square it just left.'],
    ['Sealing', 'A pawn, knight, bishop or rook that reaches its own starting square is sealed. It never moves again and can never be banished.'],
    ['Pawns', 'Pawns walk backwards: one square straight or diagonal toward their own second rank. From the fourth rank (fifth for Black) a pawn may jump two squares straight back.'],
    ['Bishops', 'Bishops are tied to a colour. The reserve holds a light-square bishop and a dark-square bishop, and each can only rise on its own colour.'],
    ['Only royals strike', 'Kings and queens can move onto an enemy comrade to banish it back to its reserve. Other pieces never capture and never give check.'],
    ['Shields', 'A comrade in its own half of the board that has a friendly piece on any neighbouring square cannot be banished.'],
    ['Courts are closed', 'No piece may step into the enemy\'s two home ranks.'],
    ['Check, never checkmate', 'You may not leave your king attacked. A move that would leave the enemy king with no way out is not allowed at all.'],
    ['Recall', 'Instead of moving, you may send one of your own unsealed comrades (or your queen) back to the reserve. Handy when a piece is stuck.'],
    ['Dawn', 'After 100 moves each, dawn breaks and the side with more pieces home wins. Equal counts go to whoever has more pieces on the board; equal again is a draw.'],
    ['The Grand Revival', 'An optional ending you can pick when you set up a match. MateCheck still wins on the spot, but if a clock runs out (or dawn breaks) nobody loses on time: the revival is counted instead. Each army scores one point for every comrade risen onto the board and one more for every piece standing home, up to 30. The higher score wins; level scores go to the army with more pieces home, and if that is level too, a fallen flag loses. Banishing an enemy comrade knocks its score down, so the royals matter right to the end.'],
    ['Clocks', 'With a time control, your clock runs on your turn and the increment is added after each move. In the classic ending, running out of time loses. In the Grand Revival, it ends the match and the revival is counted.'],
    ['Gates', 'Sealed pawns never move again. Fill your back rank first, and keep a gate open for your king and queen.']
  ];

  // ---- lesson mode (used by the tutorial) --------------------------------------------------------------
  Game.prototype.loadLesson = function (fen, lesson) {
    if (this.mode === 'match' && !this.over) { this.pauseClock(); this.save(); }
    if (this.clock) this.clock.side = 0;
    S.endJourney();
    this.mode = 'lesson';
    this.lesson = lesson;
    this.token++;
    this.thinking = false;
    this.over = null;
    this.pos = new E.Position().load(fen);
    this.start = this.pos.toString();
    this.log = [];
    this.stats = { 1: { rallies: 0, banished: 0, recalls: 0, seals: 0 }, '-1': { rallies: 0, banished: 0, recalls: 0, seals: 0 }, takebacks: 0, hints: 0 };
    this.board.userSide = 1;
    this.board.setFlipped(false);
    this.board.lastMove = null;
    this.board.showHint(0);
    this.board.setPosition(this.pos);
    $('matchLabel').textContent = 'Tutorial';
    this.renderAll();
    this.lessonTurn();
  };

  Game.prototype.lessonTurn = function () {
    if (this.pos.side !== 1) this.pos.make(E.PASS);    // the opponent sleeps through lessons
    var legal = this.pos.legalMoves([]);
    this.board.setLegal(this.lesson && this.lesson.locked ? [] : legal, !(this.lesson && this.lesson.locked));
    this.renderPanels();
  };

  Game.prototype.lessonMove = function (m) {
    var pos = this.pos, d = pos.describe(m);
    if (pos.legalMoves([]).indexOf(m) < 0) return;
    var mover = pos.side;
    var entry = this.entry(pos, m);
    pos.make(m);
    this.log.push(entry);
    this.board.playMove(d, pos);
    this.sounds(d, pos);
    this.renderLog();
    if (this.lesson && this.lesson.onMove) this.lesson.onMove(d, pos, mover);
    var self = this;
    setTimeout(function () { if (self.mode === 'lesson') self.lessonTurn(); }, 350);
  };

  Game.prototype.leave = function () {
    if (this.mode === 'match' && !this.over) { this.pauseClock(); this.save(); }
    if (this.clock) this.clock.side = 0;
    this.token++;
    this.thinking = false;
    this.mode = 'idle';
    this.board.setLegal([], false);
  };

  root.MateCheckGame = Game;
}(typeof self !== 'undefined' ? self : this));
