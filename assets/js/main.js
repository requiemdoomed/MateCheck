/*
 * MateCheck - bootstrap and screen flow
 * Copyright (c) 2026 Swayam Shakya. MIT License.
 *
 * Landing page -> (Play) -> curtains and story -> game screen -> tutorial
 * (first visit) or a new match. Also runs the little demo game on the hero.
 */
(function (root) {
  'use strict';

  var E = root.MateCheckEngine, B = root.MateCheckBrain, P = root.MateCheckPieces, S = root.MateCheckSound;
  var NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

  function $(id) { return document.getElementById(id); }
  var reduceMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var game, theatre, tutorial, demo;

  // ---- landing: the title swaps "Check" and "Mate" into place -----------------------------------
  function titleSwap() {
    var h = document.querySelector('.title-swap');
    if (!h || reduceMotion) return;
    var mate = h.querySelector('.half-mate'), check = h.querySelector('.half-check');
    var wm = mate.getBoundingClientRect().width, wc = check.getBoundingClientRect().width;
    // start as "Check" + "Mate" (the old word), end as "Mate" + "Check"
    h.style.setProperty('--to-right', wc + 'px');
    h.style.setProperty('--to-left', -wm + 'px');
    h.classList.add('is-swapping');
  }

  function stepArt() {
    var arts = {
      crown: '<div style="display:flex;gap:10px;height:76px">' + '<div style="width:68px">' + P.svg(6, 1) + '</div><div style="width:68px">' + P.svg(5, 1) + '</div></div>',
      rally: '<div style="position:relative;width:84px;height:84px;border-radius:10px;border:2px dashed #22d3c5;display:grid;place-items:center;box-shadow:0 0 24px rgba(34,211,197,.35) inset;overflow:hidden">' +
        '<div class="pc rising" style="position:relative;width:70px;height:70px;transform:none">' + P.svg(2, 1) + '</div></div>',
      seal: '<div class="pc sealed" style="position:relative;width:84px;height:84px;transform:none">' + P.svg(4, 1) + '</div>',
      win: '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;width:92%">' +
        [4, 2, 3, 5, 6, 3, 2, 4].map(function (t) { return '<div>' + P.svg(t, 1) + '</div>'; }).join('') +
        [1, 1, 1, 1, 1, 1, 1, 1].map(function (t) { return '<div>' + P.svg(t, 1) + '</div>'; }).join('') + '</div>'
    };
    document.querySelectorAll('.step-art').forEach(function (n) { n.innerHTML = arts[n.dataset.art] || ''; });
  }

  // ---- the demo game on the hero board ------------------------------------------------------------
  function Demo(node, caption) {
    this.board = new root.MateCheckBoard(node, { interactive: false });
    this.board.setOptions({ ghosts: true, coords: false });
    this.caption = caption;
    this.brain = B.factory(E, root.MateCheckWeights || null);
    this.timer = null;
    this.running = false;
    this.fields = Object.keys(E.BATTLEFIELDS);
    this.round = 0;
    this.reset();
  }

  Demo.prototype.reset = function () {
    this.pos = E.newGame(this.fields[this.round++ % this.fields.length]);
    this.board.lastMove = null;
    this.board.setPosition(this.pos);
    this.caption.textContent = 'A live demo game: ' + E.BATTLEFIELDS[this.fields[(this.round - 1) % this.fields.length]].name + '.';
  };

  Demo.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.tick(900);
  };

  Demo.prototype.stop = function () {
    this.running = false;
    clearTimeout(this.timer);
  };

  Demo.prototype.tick = function (delay) {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () {
      if (!self.running) return;
      var oc = self.pos.outcome();
      if (oc.over || self.pos.ply > 160) {
        if (oc.reason === 'matecheck') {
          self.caption.textContent = (oc.winner === 1 ? 'White' : 'Black') + ' calls MateCheck! Every piece is home.';
          self.board.wave();
        }
        self.timer = setTimeout(function () { self.reset(); self.tick(1200); }, 3200);
        return;
      }
      var r = self.brain.think(self.pos, { level: 'expert', maxDepth: 2, timeMs: 80, seed: self.pos.ply * 7919 + self.round });
      var d = self.pos.describe(r.move), mover = self.pos.side;
      self.pos.make(r.move);
      self.board.playMove(d, self.pos);
      self.caption.textContent = describe(d, mover, self.pos);
      self.tick(d.rally || d.seals ? 1500 : 1150);
    }, delay);
  };

  function describe(d, mover, pos) {
    var who = mover === 1 ? 'White' : 'Black';
    if (d.pass) return who + ' passes.';
    if (d.recall) return who + ' recalls a ' + NAMES[Math.abs(d.piece)] + '.';
    var t = who + '\'s ' + NAMES[Math.abs(d.piece)];
    if (d.seals) t += ' reaches home and is sealed';
    else if (d.captured) t += ' banishes a ' + NAMES[Math.abs(d.captured)];
    else t += ' moves to ' + E.sqName(d.to);
    if (d.rally) t += ', and a ' + NAMES[d.rally] + ' rises behind it';
    return t + '. (' + pos.formationScore(mover) + ' of 16 home)';
  }

  // ---- sound toggle on the landing page -------------------------------------------------------------
  function paintSound() {
    var b = $('landingSound'), on = !S.prefs.muted;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.sound-label').textContent = on ? 'Sound on' : 'Sound off';
  }

  var audioStarted = false;
  function firstGesture() {
    if (audioStarted) return;
    audioStarted = true;
    S.unlock();
    if (document.body.classList.contains('screen-landing') && !S.current()) S.music('hall_theme', { fade: 2.5 });
  }

  // a friendly nudge for browsers that hold the music back until the page is touched
  function soundHint() {
    var hint = $('soundHint');
    var paint = function () {
      var show = S.state() === 'locked' && !S.prefs.muted && document.body.classList.contains('screen-landing');
      hint.hidden = !show;
    };
    S.on(function (type) { if (type === 'state' || type === 'muted' || type === 'music') paint(); });
    hint.addEventListener('click', function () { S.unlock(); hint.hidden = true; });
    setTimeout(paint, 1400);
  }

  // ---- screens ----------------------------------------------------------------------------------
  function setScreen(name) {
    document.body.classList.remove('screen-landing', 'screen-theatre', 'screen-game');
    document.body.classList.add('screen-' + name);
  }

  function showLanding() {
    game.leave();
    S.stopMusic(1);
    $('game').hidden = true;
    $('coach').hidden = true;
    $('landing').hidden = false;
    setScreen('landing');
    $('resumeBtn').hidden = !game.hasSave();
    demo.start();
    root.scrollTo(0, 0);
    S.music('hall_theme', { fade: 2 });
  }

  function enterGame() {
    demo.stop();
    $('landing').hidden = true;
    var g = $('game');
    g.hidden = false;
    g.classList.remove('enter');
    void g.offsetWidth;
    g.classList.add('enter');
    setScreen('game');
  }

  function afterStory() {
    enterGame();
    theatre.hide();
    var tutorialDone = S.readPref('tutorialDone', false);
    if (!tutorialDone) {
      setTimeout(function () { tutorial.start(0); }, 1300);
    } else if (game.mode !== 'match') {
      // returning players pick their opponent and battlefield (closing the dialog keeps the last ones)
      setTimeout(function () { game.openNewGame(); }, 1300);
    }
  }

  function playShow() {
    S.unlock();
    audioStarted = true;
    demo.stop();
    setScreen('theatre');
    theatre.play().then(afterStory);
  }

  // ---- boot ------------------------------------------------------------------------------------------
  function boot() {
    P.ensureDefs();
    stepArt();
    game = new root.MateCheckGame();
    theatre = new root.MateCheckTheatre();
    tutorial = new root.MateCheckTutorial(game, function () {
      if (game.mode === 'match') return;
      if (!(game.hasSave() && game.resume())) game.openNewGame();
    });
    demo = new Demo($('demoBoard'), $('demoCaption'));
    root.MateCheck = { game: game, theatre: theatre, tutorial: tutorial, demo: demo, showLanding: showLanding };

    requestAnimationFrame(function () { setTimeout(titleSwap, 250); });
    paintSound();
    // the hall theme starts on its own if the browser allows it, otherwise on the first touch
    S.autostart('hall_theme', { fade: 2.5 });
    soundHint();
    setTimeout(function () { S.prefetch(['curtain', 'op_theme']); }, 2500);
    $('resumeBtn').hidden = !game.hasSave();

    // the demo only runs while the hero is on screen
    if ('IntersectionObserver' in root) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!document.body.classList.contains('screen-landing')) return;
          if (e.isIntersecting) demo.start(); else demo.stop();
        });
      }, { threshold: 0.2 }).observe($('demoBoard'));
    } else demo.start();

    document.addEventListener('pointerdown', firstGesture, { once: false, capture: true });
    document.addEventListener('keydown', firstGesture, { capture: true });

    $('landingSound').addEventListener('click', function () {
      S.setMuted(!S.prefs.muted);
      paintSound();
      if (!S.prefs.muted) S.music('hall_theme', { fade: 1.5 });
    });

    $('playBtn').addEventListener('click', playShow);
    $('resumeBtn').addEventListener('click', function () {
      S.unlock();
      enterGame();
      if (!game.resume()) game.newMatch(game.settings);
    });
    $('homeBtn').addEventListener('click', showLanding);
    $('storyBtn').addEventListener('click', function () {
      game.leave();
      $('coach').hidden = true;
      setScreen('theatre');
      theatre.play().then(function () {
        setScreen('game');
        theatre.hide();
        if (!game.resume()) game.newMatch(game.settings);
      });
    });
    $('tutorialBtn').addEventListener('click', function () { tutorial.start(0); });

    // closing the set-up dialog without choosing still leaves you with a match to play
    $('newGameDialog').addEventListener('close', function () {
      if (game.mode !== 'match' && !$('game').hidden && $('coach').hidden) game.newMatch(game.settings);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}(typeof self !== 'undefined' ? self : this));
