/*
 * MateCheck - the theatre: curtains and the story of the king who never won
 * Copyright (c) 2026 Swayam Shakya. MIT License.
 *
 * Scenes are plain DOM + SVG layers animated with CSS. The prologue is cut to
 * the bars of its overture (150 BPM, so one bar is 1.6 s); after that a small
 * step runner types each line, swaps music between acts and lets the viewer
 * press Next (or Space / Enter / click) to hurry along, or skip the whole show.
 */
(function (root) {
  'use strict';

  var S = root.MateCheckSound, P = root.MateCheckPieces;
  var BAR = 1.6;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // a skyline of rook-shaped towers, built from numbers so it always spans the width
  function castlePaths(fill, glow) {
    var towers = [[40, 70, 110], [150, 90, 150], [270, 60, 95], [370, 110, 200], [520, 80, 130], [640, 130, 230], [820, 80, 140], [930, 100, 180], [1070, 70, 120], [1160, 60, 90]];
    var d = 'M0 300V210H1200V300Z', lights = '';
    towers.forEach(function (t) {
      var x = t[0] - t[1] / 2, w = t[1], top = 300 - t[2], m = w / 5;
      d += 'M' + x + ' 300V' + top + 'h' + m + 'v-14h' + m + 'v14h' + m + 'v-14h' + m + 'v14h' + m + 'V300Z';
      lights += '<rect x="' + (t[0] - 6) + '" y="' + (top + 26) + '" width="12" height="18" rx="6"/>';
    });
    d += 'M640 ' + (300 - 230 - 14) + 'v-50h3v50z';
    return '<path fill="' + (fill || '#3a1252') + '" d="' + d + '"/><path class="banner" fill="#c2134a" d="M643 36l38 10-38 10z"/>' +
      '<g class="windows" fill="' + (glow || '#f6c453') + '" opacity=".85">' + lights + '</g>';
  }
  function castle(fill, glow) {
    return '<svg class="castle" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice">' + castlePaths(fill, glow) + '</svg>';
  }

  var SHADOW_KING = '<svg viewBox="0 0 100 100"><g fill="#050007">' +
    '<path d="M46 4h8v7.5h7.5v8H54V27h-8v-7.5h-7.5v-8H46z"/>' +
    '<path d="M29.5 46C25.8 33.5 36 25.6 50 28c14-2.4 24.2 5.5 20.5 18z"/>' +
    '<path d="M30 46h40v6.4H30z"/><path d="M35 52.4C35 64 31 72.4 27 80h46c-4-7.6-8-16-8-27.6z"/>' +
    '<path d="M27 80h46l5 7H22z"/><path d="M17 87h66v6H17z"/></g>' +
    '<circle class="eye" cx="43" cy="38" r="2.2"/><circle class="eye" cx="57" cy="38" r="2.2"/></svg>';

  function figure(type, color, leftPct, scale, cls) {
    var f = el('div', 'figure' + (cls ? ' ' + cls : ''), P.svg(type, color));
    f.style.left = leftPct + '%';
    if (scale) f.style.width = 'calc(clamp(56px, 9vw, 110px) * ' + scale + ')';
    return f;
  }

  function motes(kind, n) {
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<i class="' + kind + '" style="left:' + rnd(0, 100).toFixed(1) + '%;--d:' + rnd(5, 11).toFixed(2) + 's;--del:-' + rnd(0, 11).toFixed(2) + 's;--s:' + rnd(0.5, 1.3).toFixed(2) + ';--x:' + rnd(-90, 90).toFixed(0) + 'px"></i>';
    }
    return '<div class="motes">' + html + '</div>';
  }

  // the inside of a piece's svg, so it can be placed inside a bigger drawing
  function pieceInner(type, color) {
    return P.svg(type, color).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  }

  // the long panorama for the prologue: shore, fields, the capital, the peaks
  function panorama() {
    var hills = 'M0 260';
    for (var x = 0; x <= 3600; x += 120) {
      hills += 'Q' + (x + 60) + ' ' + (190 + 40 * Math.sin(x / 260)).toFixed(1) + ' ' + (x + 120) + ' ' + (225 + 25 * Math.cos(x / 340)).toFixed(1);
    }
    hills += 'V300H0Z';
    var px = [[2500, 70], [2650, 20], [2800, 90], [2950, 10], [3120, 60], [3300, 30], [3480, 80], [3600, 120]];
    var peaks = 'M2300 300L' + px.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'V300Z';
    var snow = px.map(function (p) { return 'M' + (p[0] - 22) + ' ' + (p[1] + 34) + 'L' + p[0] + ' ' + p[1] + 'L' + (p[0] + 22) + ' ' + (p[1] + 34) + 'L' + (p[0] + 8) + ' ' + (p[1] + 26) + 'L' + (p[0] - 6) + ' ' + (p[1] + 36) + 'Z'; }).join('');
    var waves = '';
    for (var w = 0; w < 9; w++) waves += '<path class="wave" style="animation-duration:' + (2 + w % 3 * 0.6) + 's" d="M' + (w * 90) + ' ' + (232 + (w % 3) * 16) + 'q20 -10 40 0t40 0" />';
    var marchers = '';
    [[1, 1060], [1, 1120], [2, 1190], [3, 1260], [4, 1330], [1, 1400], [5, 1470], [6, 1540]].forEach(function (m, i) {
      marchers += '<g transform="translate(' + m[1] + ' 214) scale(.5)"><g class="marcher" style="animation-delay:' + (i * 0.12) + 's">' + pieceInner(m[0], 1) + '</g></g>';
    });
    [[1, 2010], [2, 2080], [4, 2150], [6, 2220]].forEach(function (m, i) {
      marchers += '<g transform="translate(' + m[1] + ' 214) scale(.5)"><g class="marcher" style="animation-delay:' + (i * 0.12) + 's">' + pieceInner(m[0], -1) + '</g></g>';
    });
    var checker = '';
    for (var c = 0; c < 60; c++) {
      checker += '<rect x="' + (900 + c * 45) + '" y="262" width="45" height="19" fill="' + (c % 2 ? '#e7d8f4' : '#7b4cb2') + '"/>' +
        '<rect x="' + (900 + c * 45) + '" y="281" width="45" height="19" fill="' + (c % 2 ? '#7b4cb2' : '#e7d8f4') + '"/>';
    }
    return '<svg class="pano" viewBox="0 0 3600 300" preserveAspectRatio="xMinYMax meet">' +
      '<defs><linearGradient id="seaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fb6c9"/><stop offset="1" stop-color="#1b4f7a"/></linearGradient>' +
      '<linearGradient id="hillG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c3fa0"/><stop offset="1" stop-color="#2d0f45"/></linearGradient></defs>' +
      '<path d="' + peaks + '" fill="#241034"/><path d="' + snow + '" fill="#efe6ff" opacity=".9"/>' +
      '<path d="' + hills + '" fill="url(#hillG)" opacity=".85"/>' +
      '<rect x="0" y="220" width="820" height="80" fill="url(#seaG)"/><g class="waves" stroke="#d8f6ff" stroke-width="3" fill="none" opacity=".7">' + waves + '</g>' +
      '<path d="M700 300Q760 236 900 232L1200 230V300Z" fill="#f0dfbd"/>' +
      '<g class="ship"><path d="M126 214l38 -58 4 58z" fill="#fff8ec" stroke="#5a2a14" stroke-width="2"/><path d="M168 156v58" stroke="#5a2a14" stroke-width="3"/><path d="M96 214h100l-14 18h-72z" fill="#5a2a14"/></g>' +
      '<g transform="translate(1480 -8) scale(.95)">' + castlePaths('#2b0d40', '#ffd27a') + '</g>' +
      '<g opacity=".6">' + checker + '</g>' + marchers + '</svg>';
  }

  function birds() {
    var s = '';
    for (var i = 0; i < 5; i++) {
      s += '<svg class="bird" style="top:' + rnd(12, 30).toFixed(0) + '%;animation-duration:' + rnd(14, 22).toFixed(1) + 's;animation-delay:-' + rnd(0, 14).toFixed(1) + 's;width:' + rnd(18, 30).toFixed(0) + 'px" viewBox="0 0 40 16"><path d="M0 8q10 -10 20 0q10 -10 20 0" stroke="#2b0a3d" stroke-width="3" fill="none"/></svg>';
    }
    return s;
  }

  // ---- scene builders ---------------------------------------------------------------------
  var BUILD = {
    realm: function (sc) {
      sc.appendChild(el('div', 'sky sky-dawn'));
      sc.appendChild(el('div', 'sun-disc'));
      sc.appendChild(el('div', 'layer clouds', '<span></span><span></span><span></span><span></span>'));
      sc.appendChild(el('div', 'layer birds', birds()));
      sc.appendChild(el('div', 'layer pan-track', panorama()));
      sc.appendChild(el('div', 'layer', motes('mote gold', 26)));
      var places = el('div', 'place-names');
      [['The Ivory Shore', 'where the light pieces are born'], ['The Sixty-Four Fields', 'where every battle is fought'], ['Castle Ivory', 'home of a king who never won'], ['The Ebony Peaks', 'where the dark court waits']].forEach(function (p, i) {
        var n = el('div', 'place', '<b>' + p[0] + '</b><small>' + p[1] + '</small>');
        n.dataset.i = i;
        places.appendChild(n);
      });
      sc.appendChild(places);
      sc.appendChild(el('div', 'title-drop', '<div class="rays"></div><div class="shock"></div><div class="shock two"></div>' +
        '<div class="title-words"><span class="kicker">A tale of the backwards realm</span><span class="word">MateCheck</span><span class="tag">Rebuild. Rally. Reign.</span></div>'));
    },
    kingdom: function (sc) {
      sc.appendChild(el('div', 'sky')).style.background = 'linear-gradient(180deg, #4b1d7a 0%, #b03a7a 38%, #ff8f6b 62%, #ffd58a 78%)';
      var sun = el('div', 'layer');
      sun.style.background = 'radial-gradient(circle at 70% 58%, rgba(255,240,190,.95) 0 6vmin, rgba(255,200,120,.5) 9vmin, transparent 22vmin)';
      sc.appendChild(sun);
      sc.appendChild(el('div', 'layer clouds slow', '<span></span><span></span><span></span>'));
      sc.appendChild(el('div', 'layer castle-wrap', castle()));
      sc.appendChild(el('div', 'floor'));
      sc.appendChild(el('div', 'layer', motes('mote gold', 16)));
      // light court on the left, dark court on the right
      var cast = [[1, 1, 9, 'army'], [2, 1, 18, 'army'], [5, 1, 29, 'queen'], [6, 1, 39, 'king'],
                  [6, -1, 62, 'foe'], [3, -1, 71, 'foe'], [4, -1, 81, 'foe'], [1, -1, 91, 'foe']];
      cast.forEach(function (c, i) {
        var f = figure(c[0], c[1], c[2], c[3] === 'king' ? 1.05 : 0.85, 'bob');
        f.style.animationDelay = (i * 0.21) + 's';
        f.dataset.role = c[3];
        sc.appendChild(f);
      });
      sc.appendChild(el('div', 'clash-flash'));
    },
    lonely: function (sc) {
      sc.appendChild(el('div', 'sky')).style.background = 'linear-gradient(180deg, #05070f 0%, #101a3a 55%, #1f2a52 100%)';
      sc.appendChild(el('div', 'stars'));
      sc.appendChild(el('div', 'moon'));
      var fl = el('div', 'floor');
      fl.style.setProperty('--sat', '0.25');
      fl.style.setProperty('--bright', '0.55');
      sc.appendChild(fl);
      [[1, 12], [2, 24], [5, 64], [3, 76], [4, 88]].forEach(function (g) {
        var f = figure(g[0], 1, g[1], 0.8, 'ghostly');
        f.dataset.role = 'ghost';
        sc.appendChild(f);
      });
      var king = figure(6, 1, 46, 1.5, 'alone');
      king.dataset.role = 'king';
      sc.appendChild(king);
      var tears = el('div', 'layer');
      tears.innerHTML = '<span class="tear" style="left:49.4%;bottom:36%"></span><span class="tear" style="left:51.6%;bottom:37%;animation-delay:.7s"></span>';
      tears.style.opacity = '0';
      tears.dataset.role = 'tears';
      sc.appendChild(tears);
      sc.appendChild(el('div', 'rain'));
      sc.appendChild(el('div', 'puddle'));
      sc.appendChild(el('div', 'lightning'));
    },
    heavens: function (sc) {
      var sky = el('div', 'sky');
      sky.style.background = 'linear-gradient(180deg, #120a2a 0%, #3b2a6e 45%, #7a5aa8 100%)';
      sky.style.transition = 'background 3s';
      sc.appendChild(sky);
      sc.appendChild(el('div', 'heaven-glow'));
      sc.appendChild(el('div', 'beams'));
      sc.appendChild(el('div', 'layer', motes('mote light', 30)));
      sc.appendChild(el('div', 'floor'));
      sc.appendChild(el('div', 'clock'));
      var king = figure(6, 1, 43, 1.2, '');
      king.dataset.role = 'king';
      sc.appendChild(king);
      var queen = figure(5, 1, 54, 1.1, '');
      queen.style.opacity = '0';
      queen.dataset.role = 'queen';
      sc.appendChild(queen);
      sc.appendChild(el('div', 'rewind-lines'));
      sc.appendChild(el('div', 'whiteout'));
    },
    cliff: function (sc) {
      sc.appendChild(el('div', 'sky')).style.background = 'radial-gradient(ellipse at 50% 100%, #2a0410 0%, #0a0105 55%, #000 100%)';
      sc.appendChild(el('div', 'layer', motes('mote ember', 22)));
      var sk = el('div', 'shadow-king', SHADOW_KING);
      sk.dataset.role = 'shadow';
      sc.appendChild(sk);
      sc.appendChild(el('div', 'to-be-continued', '<span>To be continued...</span>'));
    }
  };

  // ---- the script ----------------------------------------------------------------------------
  // the prologue runs on the clock of its overture: [bar, text]
  var PROLOGUE = [
    [0.6, 'Long ago, before anyone thought to count the moves, there was the Chess Kingdom.'],
    [4.6, 'Sixty-four lands of light and shadow, from the Ivory Shore to the Ebony Peaks.'],
    [8.6, 'Every dawn, two courts marched out to meet each other. Every dusk, one king fell.'],
    [12.6, 'That was the law. And nobody ever thought to question it.']
  ];
  // place names fade in as the camera passes each land (seconds into the overture)
  var PLACES = [1.0, 7.4, 13.2, 19.6];
  var TITLE_BAR = 16, HIT_BAR = 22, PROLOGUE_END_BAR = 25;

  // the acts: { scene, music, act, title, lines: [ [text, speaker, effect] ] }
  var SCRIPT = [
    { scene: 'kingdom', music: 'story_adventure', act: 'Act one', title: 'The Old Realm', lines: [
      ['Long ago! In the chess kingdom, life was normal and real.', 'narrator'],
      ['Players met across the sixty-four squares every day, conquering the opponent\'s king and the entire board.', 'narrator', 'march'],
      ['Glory went to the bold. Songs were sung for the clever. And the fallen... were simply swept off the board.', 'narrator'],
      ['But in one quiet corner of the realm lived a king who had never won a single game.', 'narrator'],
      ['Stay behind me, my king. Whatever happens, don\'t look back.', 'queen'],
      ['Seren, wait! Not again...!', 'king', 'battle'],
      ['Live, my king. Live, and play again.', 'queen', 'queenFalls']
    ] },
    { scene: 'lonely', music: 'story_lament', act: 'Act two', title: 'The King Who Never Won', lines: [
      ['The game went the way it always went.', 'narrator', 'rain'],
      ['Sad and lonely, he watched his army fall again, until he was the only one left to cry.', 'narrator', 'tears'],
      ['I am done with this chess... and with every one of its rules!', 'king'],
      ['I don\'t want to be alone. I don\'t want my army to die.', 'king'],
      ['My queen always leaves me. In every game, she is the first one they take.', 'king'],
      ['I want to build an army with her. Pawns, rooks, bishops and knights... they aren\'t pieces to me. They are my friends. My comrades. I don\'t want to lose them anymore.', 'king'],
      ['So hear me, heavens! Make my wish come true, and let it ring through the whole chess realm!', 'king', 'storm']
    ] },
    { scene: 'heavens', music: 'story_heavens', act: 'Act three', title: 'A Voice From the Heavens', lines: [
      ['The moment he wished it, the clouds tore open, and a voice older than the board itself answered.', 'narrator', 'open'],
      ['Little king. You would trade every victory, just to keep your friends?', 'heaven'],
      ['Every victory. Every time.', 'king'],
      ['Then so be it.', 'heaven', 'grant'],
      ['From this day on, the realm runs backwards. No piece shall fall forever, and every battle will end where it once began.', 'heaven', 'reverse'],
      ['Kings and queens shall stand alone at first. Bring the others home, square by square, and the board will remember them.', 'heaven'],
      ['And so the chess realm was changed forever. One by one, the fallen began to rise.', 'narrator', 'rise'],
      ['...My king? You called us back?', 'queen'],
      ['This time, nobody gets left behind.', 'king']
    ] },
    { scene: 'cliff', music: 'story_cliffhanger', lines: [
      ['But far beyond the edge of the board, on a square no map has ever shown, something stirred.', 'narrator', 'shadow'],
      ['An old law, older than any king, had not been granted a wish.', 'narrator'],
      ['Rebuild your little army, Ivory King. Line them up nicely, every one of them, back where they belong...', 'shadow'],
      ['Checkmate... does not forget.', 'shadow', 'continued']
    ] }
  ];

  var SPEAKERS = { king: 'The King', queen: 'The Queen', heaven: 'The Voice', shadow: '???' };

  // ---- runner ---------------------------------------------------------------------------------
  function Theatre() {
    this.node = $('theatre');
    this.stage = $('storyStage');
    this.timers = [];
    this.running = false;
    this.bind();
  }

  Theatre.prototype.bind = function () {
    var self = this;
    $('skipStoryBtn').addEventListener('click', function () { self.skip(); });
    $('storyNextBtn').addEventListener('click', function () { self.advance(); });
    var nb = $('narratorBtn');
    var paint = function () { nb.setAttribute('aria-pressed', String(S.narrator.on)); nb.textContent = 'Narrator: ' + (S.narrator.on ? 'on' : 'off'); };
    paint();
    nb.addEventListener('click', function () { S.setNarrator(!S.narrator.on); paint(); });
    this.stage.addEventListener('click', function () { self.advance(); });
    document.addEventListener('keydown', function (e) {
      if (!self.running) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); self.advance(); }
      else if (e.key === 'Escape') { e.preventDefault(); self.skip(); }
    });
  };

  Theatre.prototype.later = function (fn, ms) {
    var self = this, t = setTimeout(function () {
      var i = self.timers.indexOf(t);
      if (i >= 0) self.timers.splice(i, 1);
      if (self.running) fn();
    }, ms);
    this.timers.push(t);
    return t;
  };

  Theatre.prototype.clearTimers = function () {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.waitTimer = null;
    if (this.typer) { clearInterval(this.typer); this.typer = null; }
  };

  // shake the whole stage for a beat
  Theatre.prototype.shake = function (big) {
    var n = this.stage;
    n.classList.remove('shake', 'shake-big'); void n.offsetWidth;
    n.classList.add(big ? 'shake-big' : 'shake');
  };

  // close the curtain, run `mid` while it is shut, then open it again
  Theatre.prototype.curtainSwap = function (mid, done) {
    var self = this;
    this.node.classList.add('curtains-closed');
    S.sfx('whoosh');
    this.later(function () {
      if (mid) mid();
      self.later(function () {
        self.node.classList.remove('curtains-closed');
        S.sfx('whoosh');
        if (done) self.later(done, 900);
      }, 500);
    }, 1850);
  };

  // the whole show: resolves when the story ends or is skipped
  Theatre.prototype.play = function () {
    var self = this;
    this.clearTimers();
    this.running = true;
    this.node.hidden = false;
    this.node.classList.add('curtains-closed');
    this.stage.innerHTML = '';
    this.scene = null;
    this.mode = 'intro';
    $('storyNextBtn').hidden = false;
    S.preload(['op_theme', 'story_adventure', 'story_lament', 'story_heavens', 'wish_granted', 'story_cliffhanger', 'cliff_hit']);
    S.stopMusic(1.0);
    return new Promise(function (resolve) {
      self.resolve = resolve;
      S.sting('curtain', { duck: 1 });
      self.later(function () { self.prologue(); }, 1700);
    });
  };

  // ---- the prologue: a long pan across the realm, cut to the overture ---------------------------
  Theatre.prototype.prologue = function () {
    var self = this;
    this.mode = 'prologue';
    this.act = -1;
    var sc = el('div', 'scene letterbox prologue');
    BUILD.realm(sc);
    var box = el('div', 'narration');
    sc.appendChild(box);
    this.stage.appendChild(sc);
    this.scene = sc;
    requestAnimationFrame(function () { sc.classList.add('on'); });
    this.node.classList.remove('curtains-closed');
    S.sfx('whoosh');

    var started = false;
    var go = function () {
      if (started || self.mode !== 'prologue') return;
      started = true;
      sc.classList.add('rolling');
      var ms = function (bar) { return bar * BAR * 1000; };
      PROLOGUE.forEach(function (p) {
        self.later(function () { self.typeLine(p[1], 'narrator', true); }, ms(p[0]));
      });
      PLACES.forEach(function (at, i) {
        self.later(function () {
          var places = sc.querySelectorAll('.place');
          for (var k = 0; k < places.length; k++) places[k].classList.toggle('show', +places[k].dataset.i === i);
        }, at * 1000);
      });
      self.later(function () {
        box.classList.add('gone');
        var pl = sc.querySelector('.place.show');
        if (pl) pl.classList.remove('show');
        sc.querySelector('.title-drop').classList.add('on');
        self.shake(true);
      }, ms(TITLE_BAR));
      self.later(function () { sc.classList.add('hit'); self.shake(false); }, ms(HIT_BAR));
      self.later(function () { self.endPrologue(); }, ms(PROLOGUE_END_BAR));
    };
    S.music('op_theme', { fade: 0.05, restart: true }).then(function () { if (self.running) go(); });
    this.later(go, 2600);       // no sound (or still decoding): run on the plain clock
  };

  Theatre.prototype.endPrologue = function () {
    if (this.mode !== 'prologue') return;
    this.mode = 'acts';
    this.clearTimers();
    this.act = -1;
    this.nextAct();
  };

  Theatre.prototype.nextAct = function () {
    var self = this;
    this.act++;
    if (this.act >= SCRIPT.length) { this.finale(); return; }
    var a = SCRIPT[this.act];
    var build = function () {
      self.stage.innerHTML = '';
      var sc = el('div', 'scene letterbox scene-' + a.scene);
      BUILD[a.scene](sc);
      if (a.title) sc.appendChild(el('div', 'scene-title', '<small>' + a.act + '</small><span>' + a.title + '</span><i class="title-rule"></i>'));
      sc.appendChild(el('div', 'narration'));
      self.stage.appendChild(sc);
      self.scene = sc;
      S.music(a.music, { fade: 2.2 });
      requestAnimationFrame(function () { sc.classList.add('on'); });
    };
    var start = function () {
      var t = self.scene.querySelector('.scene-title');
      if (t) {
        self.later(function () { t.classList.add('show'); S.sfx('seal'); }, 300);
        self.later(function () { t.classList.remove('show'); }, 3600);
      }
      self.line = -1;
      self.later(function () { self.nextLine(); }, t ? 3900 : 1200);
    };
    this.curtainSwap(build, start);
  };

  Theatre.prototype.nextLine = function () {
    var a = SCRIPT[this.act];
    this.line++;
    if (this.line >= a.lines.length) { this.nextAct(); return; }
    var ln = a.lines[this.line];
    if (ln[2]) this.effect(ln[2]);
    this.typeLine(ln[0], ln[1], false);
  };

  // type a line into the narration box; `timed` lines (the prologue) don't wait for the viewer
  Theatre.prototype.typeLine = function (text, who, timed) {
    var self = this, box = this.scene.querySelector('.narration');
    if (this.typer) { clearInterval(this.typer); this.typer = null; }
    box.className = 'narration' + (who !== 'narrator' ? ' speech who-' + who : '');
    box.innerHTML = '';
    if (SPEAKERS[who]) box.appendChild(el('span', 'speaker', SPEAKERS[who]));
    var out = el('span', 'line');
    box.appendChild(out);
    box.appendChild(el('span', 'caret'));
    void box.offsetWidth;
    box.classList.add('pop');
    // the piece that is talking steps forward
    var all = this.scene.querySelectorAll('[data-role]');
    for (var k = 0; k < all.length; k++) all[k].classList.toggle('talking', all[k].dataset.role === who);
    var i = 0;
    this.typing = true;
    this.fullText = text;
    this.timed = timed;
    S.speak(text, who === 'heaven' ? 'heaven' : (who === 'narrator' ? 'narrator' : 'king'));
    var speed = who === 'heaven' || who === 'shadow' ? 44 : (timed ? 34 : 28);
    this.typer = setInterval(function () {
      i++;
      out.textContent = text.slice(0, i);
      if (i % 3 === 0 && who !== 'heaven' && !timed) S.sfx('tick');
      if (i >= text.length) self.doneTyping();
    }, speed);
  };

  Theatre.prototype.doneTyping = function () {
    var self = this;
    if (this.typer) { clearInterval(this.typer); this.typer = null; }
    this.typing = false;
    var box = this.scene.querySelector('.narration');
    var out = box.querySelector('.line');
    if (out) out.textContent = this.fullText;
    box.classList.add('done');
    if (this.timed) return;
    var hold = Math.max(2400, this.fullText.length * 52);
    if (S.narrator.on) hold += 1500;
    this.waitTimer = this.later(function () { self.waitTimer = null; self.nextLine(); }, hold);
  };

  // Next / click / space: finish the line, or move on if it is already finished
  Theatre.prototype.advance = function () {
    if (!this.running || !this.scene) return;
    S.sfx('click');
    if (this.mode === 'prologue') { S.hush(); this.endPrologue(); return; }
    if (this.typing) { this.doneTyping(); return; }
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      var i = this.timers.indexOf(this.waitTimer);
      if (i >= 0) this.timers.splice(i, 1);
      this.waitTimer = null;
      S.hush();
      this.nextLine();
    }
  };

  Theatre.prototype.effect = function (name) {
    var sc = this.scene, self = this;
    var q = function (sel) { return sc.querySelector(sel); };
    var all = function (sel) { return Array.prototype.slice.call(sc.querySelectorAll(sel)); };
    var flashClash = function () {
      var c = q('.clash-flash');
      if (!c) return;
      c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
    };
    var bolt = function () {
      var l = q('.lightning');
      if (!l) return;
      l.classList.remove('flash'); void l.offsetWidth; l.classList.add('flash');
      S.sfx('thunder');
      self.shake(false);
    };
    switch (name) {
      case 'march':
        all('[data-role="foe"]').forEach(function (f, i) {
          f.classList.remove('bob');
          f.classList.add('advance');
          f.style.animationDelay = (i * 0.15) + 's';
        });
        break;
      case 'battle':
        sc.classList.add('battle');
        self.later(function () { flashClash(); self.shake(true); S.sfx('banish'); }, 500);
        all('[data-role="army"]').forEach(function (f, i) {
          self.later(function () { f.classList.remove('bob'); f.classList.add('fall'); S.sfx('banish'); }, 1000 + i * 520);
        });
        self.later(function () { var s = q('.sky'); s.style.transition = 'filter 3s'; s.style.filter = 'saturate(.55) brightness(.7) hue-rotate(-20deg)'; }, 1200);
        break;
      case 'queenFalls':
        self.later(function () {
          var qn = q('[data-role="queen"]');
          qn.classList.remove('bob', 'talking');
          qn.classList.add('fall', 'slow');
          flashClash();
          self.shake(false);
          S.sfx('check');
        }, 2200);
        break;
      case 'rain':
        q('.rain').classList.add('on');
        q('.puddle').classList.add('on');
        break;
      case 'tears':
        q('[data-role="tears"]').style.transition = 'opacity 1.5s';
        q('[data-role="tears"]').style.opacity = '1';
        all('[data-role="ghost"]').forEach(function (g, i) { self.later(function () { g.classList.add('fade-up'); }, 1200 + i * 500); });
        break;
      case 'storm':
        sc.classList.add('storming');
        self.later(bolt, 1200);
        self.later(bolt, 3600);
        var k = q('[data-role="king"]');
        k.style.transition = 'transform 1.2s cubic-bezier(.34,1.56,.64,1)';
        self.later(function () { k.style.transform = 'translateY(-8%) scale(1.08)'; }, 900);
        break;
      case 'open':
        q('.heaven-glow').classList.add('on');
        self.later(function () { q('.beams').classList.add('on'); }, 800);
        self.later(function () { q('.sky').style.background = 'linear-gradient(180deg, #ffe9b0 0%, #f6c453 30%, #b06ab3 75%, #4b1d7a 100%)'; }, 600);
        break;
      case 'grant':
        S.sting('wish_granted', { duck: 0.4 });
        self.later(function () { var w = q('.whiteout'); w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash'); self.shake(false); }, 2500);
        break;
      case 'reverse':
        q('.clock').classList.add('on');
        q('.rewind-lines').classList.add('on');
        S.sfx('recall');
        self.later(function () { q('.rewind-lines').classList.remove('on'); }, 3800);
        break;
      case 'rise':
        var queen = q('[data-role="queen"]');
        queen.classList.add('rise');
        queen.style.opacity = '1';
        S.sfx('rally');
        [[1, 12], [2, 21], [3, 30], [4, 72], [3, 81], [1, 90]].forEach(function (c, i) {
          self.later(function () {
            var f = figure(c[0], 1, c[1], 0.75, 'rise');
            sc.insertBefore(f, q('.rewind-lines'));
            S.sfx(i % 2 ? 'rally' : 'seal');
          }, 1400 + i * 650);
        });
        break;
      case 'shadow':
        self.later(function () { q('.shadow-king').classList.add('on'); }, 600);
        break;
      case 'continued':
        self.later(function () {
          q('.to-be-continued').classList.add('on');
          self.shake(true);
          S.stopMusic(0.4);
          S.sting('cliff_hit', { duck: 1 });
        }, 3200);
        break;
    }
  };

  Theatre.prototype.finale = function () {
    var self = this;
    this.later(function () {
      var card = el('div', 'title-card', '<div class="rays"></div><div class="card-words"><p class="next">Next time</p><div class="big">Your Reign Begins</div><p class="sub">Rally the fallen. Bring them home. Call MateCheck.</p></div>');
      self.stage.appendChild(card);
      requestAnimationFrame(function () { card.classList.add('on'); });
      S.music('hall_theme', { fade: 2 });
      self.later(function () { self.end(); }, 4400);
    }, 5200);
  };

  Theatre.prototype.skip = function () {
    if (!this.running) return;
    S.hush();
    this.clearTimers();
    this.end();
  };

  Theatre.prototype.end = function () {
    var self = this;
    if (!this.running) return;
    this.running = false;
    this.mode = '';
    this.clearTimers();
    S.hush();
    $('storyNextBtn').hidden = true;
    this.node.classList.add('curtains-closed');
    S.sfx('whoosh');
    setTimeout(function () {
      self.stage.innerHTML = '';
      self.scene = null;
      if (self.resolve) { var r = self.resolve; self.resolve = null; r(); }
    }, 1900);
  };

  // fold the theatre away (after the game screen is underneath)
  Theatre.prototype.hide = function () {
    var self = this;
    this.node.classList.add('revealing');
    this.node.classList.remove('curtains-closed');
    S.sfx('whoosh');
    setTimeout(function () {
      self.node.hidden = true;
      self.node.classList.remove('revealing');
      self.node.classList.add('curtains-closed');
    }, 1900);
  };

  Theatre.SCRIPT = SCRIPT;
  Theatre.PROLOGUE = PROLOGUE;
  root.MateCheckTheatre = Theatre;
}(typeof self !== 'undefined' ? self : this));
