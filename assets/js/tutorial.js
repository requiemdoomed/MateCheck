/*
 * MateCheck - the tutorial
 * Copyright (c) 2026 Swayam Shakya. MIT License.
 *
 * Twelve short lessons played on the real board. Each lesson is a position,
 * a few lines of text and (usually) a task. "Show me" finds a move that solves
 * the task by simply trying every legal move against the lesson's goal.
 */
(function (root) {
  'use strict';

  var E = root.MateCheckEngine, S = root.MateCheckSound;
  function $(id) { return document.getElementById(id); }

  var LESSONS = [
    {
      title: 'Welcome to the reversed realm',
      fen: '8/3q4/3k4/8/8/3K4/3Q4/8 w P8N2L1D1R2Q0 P8N2L1D1R2Q0 0 200',
      locked: true,
      text: ['In real chess you start with sixteen pieces and often end with a lonely king. Here it is the other way round.',
        'Both sides begin with <b>only a king and a queen</b>. The other fourteen pieces have fallen and wait in your <b>reserve</b>, shown in your panel.',
        'Your goal is <b>MateCheck</b>: all sixteen of your pieces standing on their classic starting squares. The golden ghosts on the board show where each one belongs.']
    },
    {
      title: 'Four bands on the board',
      fen: '4k3/8/8/8/8/3QK3/8/8 w P8N2L1D1R2Q0 P8N2L1D1R2Q1 0 200',
      locked: true,
      text: ['Look at the colours. The gold bands at both ends are the <b>courts</b>: each army\'s two home ranks.',
        'Teal is <b>White\'s muster ground</b> (ranks 3 and 4). Pink is <b>Black\'s muster ground</b> (ranks 6 and 5). Fallen pieces can only rise on their own muster ground.',
        'One more law: <b>nobody ever enters the enemy\'s court</b>. Black\'s home ranks are off limits to you, and yours to Black.']
    },
    {
      title: 'Rally the fallen',
      fen: '4k3/8/8/8/8/3QK3/8/8 w P8N2L1D1R2Q0 P8N2L1D1R2Q1 0 200',
      text: ['Every time one of your pieces <b>leaves a square on your muster ground</b>, a comrade from the reserve can rise on the square it just left.',
        'After you pick where to move, a small picker asks <b>who rises</b>. The highlighted choice is usually the smartest.'],
      task: 'Move your queen anywhere and raise a comrade on d3.',
      done: 'A comrade rises! Most good moves in MateCheck raise someone.',
      goal: function (d) { return d.rally > 0 && d.from === E.parseSq('d3'); }
    },
    {
      title: 'Sealing',
      fen: '4k3/8/8/8/4K3/2N1P3/8/8 w P7N1L1D1R2Q1 P8N2L1D1R2Q1 0 200',
      text: ['When a pawn, knight, bishop or rook reaches <b>its own starting square</b>, it is <b>sealed</b>: it never moves again and can never be banished.',
        'Sealed pieces glow gold and carry a small lock.'],
      task: 'Seal a piece: step the pawn from e3 to e2, or hop the knight from c3 to b1.',
      done: 'Sealed for good. One fewer piece to worry about.',
      goal: function (d) { return d.seals; }
    },
    {
      title: 'Pawns walk backwards',
      fen: '4k3/8/8/8/3P4/8/8/4K3 w P7N2L1D1R2Q1 P8N2L1D1R2Q1 0 200',
      text: ['Pawns march <b>back toward their own second rank</b>: one square straight back, or one square diagonally back.',
        'From the <b>fourth rank</b> a pawn may jump <b>two squares straight back</b>, the mirror image of the usual opening double step.'],
      task: 'Jump the pawn on d4 two squares back to d2.',
      done: 'Home in one move. Raising pawns on the fourth rank saves time.',
      goal: function (d) { return Math.abs(d.piece) === 1 && d.from === E.parseSq('d4') && d.to === E.parseSq('d2'); }
    },
    {
      title: 'Chains of comrades',
      fen: '4k3/8/8/8/8/2P5/8/4K3 w P7N2L1D1R2Q1 P8N2L1D1R2Q1 0 200',
      text: ['Here is the rhythm that wins games: a comrade <b>steps home from the muster ground</b> and, in the same move, <b>raises the next comrade</b> behind it.',
        'One move, two jobs done. Strong players keep a chain like this running.'],
      task: 'Seal the pawn on c3 at c2 and raise another comrade on c3 in the same move.',
      done: 'That is the chain. Seal and rally, seal and rally.',
      goal: function (d) { return d.seals && d.rally > 0; }
    },
    {
      title: 'Bishops keep their colour',
      fen: '4k3/8/8/8/8/2K5/8/8 w P8N2L1D1R2Q1 P8N2L1D1R2Q1 0 200',
      text: ['Your reserve holds one <b>light-square bishop</b> and one <b>dark-square bishop</b>. Each can only rise on a square of its own colour.',
        'The light one belongs on f1 and the dark one on c1 (for Black: c8 is light, f8 is dark).'],
      task: 'Move your king off c3 and raise a bishop there. c3 is dark, so only the dark-square bishop can rise.',
      done: 'The dark-square bishop is up. It can never reach f1, only c1.',
      goal: function (d) { return d.rally === 3; }
    },
    {
      title: 'Leave a gate open',
      fen: '4k3/8/8/8/8/3R4/PPP1PPPP/4K3 w P1N2L1D1R1Q1 P8N2L1D1R2Q1 0 200',
      text: ['Sealed pawns never move again. If your whole pawn wall seals early, <b>rooks, bishops and royals can never reach the back rank</b>. Only knights can jump in.',
        'Here a single gate is open on d2. Use it before it closes. In real games: <b>fill your back rank first</b>.'],
      task: 'Bring the rook through the d2 gate and home to a1. It takes two moves.',
      done: 'Home through the gate. Always plan the last few pieces before you close the wall.',
      goal: function (d) { return Math.abs(d.piece) === 4 && d.seals; }
    },
    {
      title: 'Only royals strike',
      fen: '4k3/8/5pp1/8/3n4/8/8/3QK3 w P8N2L1D1R2Q0 P6N1L1D1R2Q1 0 200',
      text: ['Nobody dies in the reversed realm. Only <b>kings and queens</b> can move onto an enemy comrade, and that <b>banishes</b> it back to its reserve. Other pieces never capture and never give check.',
        'But comrades <b>shield each other</b>: in its own half, a comrade with a friend on a neighbouring square cannot be banished. Select your queen to see the shield marks on f6 and g6.',
        'The knight on d4 is alone in your half, so it is fair game.'],
      task: 'Banish the black knight on d4 with your queen.',
      done: 'Banished. It goes back to Black\'s reserve and must rise again.',
      goal: function (d) { return !!d.captured; }
    },
    {
      title: 'Check, but never checkmate',
      fen: '6nk/8/6K1/8/8/8/8/3Q4 w P8N2L1D1R2Q0 P8N1L1D1R2Q1 30 200',
      locked: true,
      text: ['Check still exists. You can never leave your own king attacked, and a checked king must get out of it.',
        'Checkmate, though, is <b>outlawed</b>. Here Queen d1 to h5 would trap the black king with no escape, so the move is simply not allowed. Kings can be hunted and harried, never cornered.',
        'Royal checks are still useful: they force your opponent to spend a move on their king.']
    },
    {
      title: 'Recall a stuck comrade',
      fen: '4k3/8/8/8/8/1P6/PPP5/4K3 w P4N2L1D1R2Q1 P8N2L1D1R2Q1 0 200',
      text: ['Pawns cannot step sideways or forwards, so a pawn can get stuck. Here the b3 pawn has no free square behind it.',
        'Instead of moving, you can <b>recall</b> one of your unsealed comrades: it goes back to the reserve and can rise again somewhere better.'],
      task: 'Select the pawn on b3 and press the Recall button under the board.',
      done: 'Recalled. It waits in the reserve for a better square.',
      goal: function (d) { return d.recall; }
    },
    {
      title: 'Dawn, and you are ready',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w P0N0L0D0R0Q0 P0N0L0D0R0Q0 0 200',
      locked: true,
      text: ['This is what you are building: the classic starting position. The first army to stand like this calls <b>MateCheck</b> and wins.',
        'If nobody manages it, <b>dawn breaks after 100 moves each</b> and whoever has more pieces home wins. Stalling never saves you: dawn always comes.',
        'Prefer a race against the clock? Pick <b>the Grand Revival</b> when you set up a match. When time runs out, the revival is counted: one point for every comrade back on the board, one more for every piece home.',
        'Last advice: raise pieces close to home, keep a chain running, guard your muster ground with your king, and raid with your queen when the computer leaves comrades alone.']
    }
  ];

  function Tutorial(game, onFinish) {
    this.game = game;
    this.onFinish = onFinish;
    this.i = 0;
    this.solved = false;
    this.bind();
  }

  Tutorial.prototype.bind = function () {
    var self = this;
    $('coachNext').addEventListener('click', function () { self.next(); });
    $('coachBack').addEventListener('click', function () { if (self.i > 0) self.show(self.i - 1); });
    $('coachHint').addEventListener('click', function () { self.showMe(); });
    $('coachSkip').addEventListener('click', function () { self.finish(true); });
  };

  Tutorial.prototype.start = function (index) {
    $('coach').hidden = false;
    document.body.classList.add('in-tutorial');
    S.music('tutorial_theme', { fade: 2 });
    this.show(index || 0);
  };

  Tutorial.prototype.show = function (i) {
    var self = this, L = LESSONS[i];
    this.i = i;
    this.solved = !!L.locked;
    $('coachProgress').textContent = 'Lesson ' + (i + 1) + ' of ' + LESSONS.length;
    $('coachTitle').textContent = L.title;
    $('coachText').innerHTML = L.text.map(function (t) { return '<p>' + t + '</p>'; }).join('');
    var task = $('coachTask');
    task.textContent = L.task || '';
    task.className = 'coach-task';
    $('coachBack').disabled = i === 0;
    $('coachHint').hidden = !!L.locked;
    $('coachNext').textContent = i === LESSONS.length - 1 ? 'Start playing' : 'Next';
    this.refreshNext();
    this.game.loadLesson(L.fen, {
      locked: !!L.locked,
      onMove: function (d, pos) { self.check(d, pos); },
      reset: function () { self.show(self.i); }
    });
    this.game.status(L.locked ? 'Read on, then press Next.' : 'Your move. Undo resets the lesson.');
    // on small screens keep the board in view above the coach
    if (root.innerWidth <= 860) {
      var board = $('board');
      setTimeout(function () { board.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 120);
    }
  };

  Tutorial.prototype.refreshNext = function () {
    $('coachNext').disabled = !this.solved;
  };

  Tutorial.prototype.check = function (d, pos) {
    var L = LESSONS[this.i];
    if (!L.goal || this.solved) return;
    if (L.goal(d, pos)) {
      this.solved = true;
      var task = $('coachTask');
      task.textContent = L.done;
      task.className = 'coach-task done';
      this.refreshNext();
      this.game.board.showHint(0);
      setTimeout(function () { S.sfx('hint'); }, 500);
      $('coachNext').focus({ preventScroll: true });
    } else {
      this.game.status('Not quite. Try again, or press Show me. Undo resets the lesson.');
    }
  };

  // find any legal move that would solve this lesson and point at it
  Tutorial.prototype.showMe = function () {
    var L = LESSONS[this.i], pos = this.game.pos;
    if (!L.goal) return;
    var moves = pos.legalMoves([]);
    for (var i = 0; i < moves.length; i++) {
      var d = pos.describe(moves[i]);
      pos.make(moves[i]);
      var ok = L.goal(d, pos);
      pos.unmake();
      if (ok) {
        this.game.board.showHint(moves[i]);
        if (d.recall) this.game.board.select(d.from);
        this.game.status('Try this: ' + this.game.prettyNotation(pos.notation(moves[i])) + '.');
        S.sfx('hint');
        return;
      }
    }
    this.game.status('Undo resets the lesson, then try again.');
  };

  Tutorial.prototype.next = function () {
    if (!this.solved) return;
    S.sfx('click');
    if (this.i < LESSONS.length - 1) this.show(this.i + 1);
    else this.finish(false);
  };

  Tutorial.prototype.finish = function (skipped) {
    $('coach').hidden = true;
    document.body.classList.remove('in-tutorial');
    S.writePref('tutorialDone', true);
    this.game.leave();
    if (this.onFinish) this.onFinish(skipped);
  };

  Tutorial.LESSONS = LESSONS;
  root.MateCheckTutorial = Tutorial;
}(typeof self !== 'undefined' ? self : this));
