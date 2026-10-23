/*
 * MateCheck - the board you touch
 * Copyright (c) 2026 Swayam Shakya. MIT License.
 *
 * Renders a Position, animates moves (slide, rise, seal, banish, recall),
 * and turns clicks / drags into moves. Rally choices go through a small picker
 * that pops up on the square being left.
 */
(function (root) {
  'use strict';

  var E = root.MateCheckEngine, P = root.MateCheckPieces;
  var NAMES = ['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function zoneOf(rank) {
    if (rank <= 1 || rank >= 6) return 'c';
    return rank <= 3 ? 'w' : 'b';
  }

  function Board(node, opts) {
    this.node = node;
    this.opts = opts || {};
    this.flipped = false;
    this.userSide = 1;
    this.enabled = false;
    this.pos = null;
    this.map = {};             // square -> piece element
    this.legal = [];
    this.byFrom = {};
    this.selected = -1;
    this.picker = null;
    this.drag = null;
    this.hint = null;
    this.lastMove = null;
    this.checkSq = -1;
    this.build();
  }

  Board.prototype.build = function () {
    P.ensureDefs();
    var n = this.node;
    n.classList.add('mc-board');
    n.innerHTML = '';
    this.grid = el('div', 'grid');
    this.sqEls = [];
    for (var i = 0; i < 64; i++) {
      var s = el('div', 'sq');
      s.dataset.sq = String(i);
      this.sqEls[i] = s;
    }
    n.appendChild(this.grid);
    this.arrows = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrows.setAttribute('class', 'arrow-layer');
    this.arrows.setAttribute('viewBox', '0 0 800 800');
    this.arrows.setAttribute('preserveAspectRatio', 'none');
    n.appendChild(this.arrows);
    this.layer = el('div', 'pieces');
    n.appendChild(this.layer);
    this.waveEl = el('div', 'board-wave');
    n.appendChild(this.waveEl);
    this.layout();
    if (this.opts.interactive) this.bindInput();
  };

  // display coordinates for a square
  Board.prototype.xy = function (sq) {
    var f = sq & 7, r = sq >> 3;
    return this.flipped ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
  };

  Board.prototype.layout = function () {
    var g = this.grid;
    g.innerHTML = '';
    var order = [];
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        var f = this.flipped ? 7 - x : x, r = this.flipped ? y : 7 - y;
        order.push(r * 8 + f);
      }
    }
    for (var i = 0; i < 64; i++) {
      var sq = order[i], s = this.sqEls[sq], file = sq & 7, rank = sq >> 3;
      var cls = 'sq ' + (((file + rank) & 1) ? 'light' : 'dark') + ' z' + zoneOf(rank);
      var above = this.flipped ? rank - 1 : rank + 1;
      if (above >= 0 && above <= 7 && zoneOf(above) !== zoneOf(rank)) cls += ' edge-top';
      else if (above >= 0 && above <= 7 && ((rank === 3 && above === 4) || (rank === 4 && above === 3))) cls += ' edge-mid';
      s.className = cls;
      var coords = '';
      if ((i >> 3) === 7) coords += '<span class="coord f">' + 'abcdefgh'[file] + '</span>';
      if ((i & 7) === 0) coords += '<span class="coord r">' + (rank + 1) + '</span>';
      s.innerHTML = coords;
      g.appendChild(s);
    }
    this.placeAll();
    this.refreshGhosts();
  };

  Board.prototype.setFlipped = function (f) {
    if (this.flipped === !!f) return;
    this.flipped = !!f;
    this.layout();
    this.refreshMarks();
  };

  Board.prototype.setOptions = function (o) {
    this.node.classList.toggle('no-ghosts', o.ghosts === false);
    this.node.classList.toggle('no-coords', o.coords === false);
  };

  // ---- pieces ----------------------------------------------------------------------
  Board.prototype.makePiece = function (code, sq) {
    var p = el('div', 'pc', P.svg(Math.abs(code), code > 0 ? 1 : -1));
    p.dataset.code = String(code);
    this.place(p, sq);
    this.layer.appendChild(p);
    return p;
  };

  Board.prototype.place = function (p, sq) {
    var c = this.xy(sq);
    p.style.setProperty('--x', c.x);
    p.style.setProperty('--y', c.y);
    p.dataset.sq = String(sq);
  };

  Board.prototype.placeAll = function () {
    for (var k in this.map) if (Object.prototype.hasOwnProperty.call(this.map, k)) this.place(this.map[k], +k);
  };

  Board.prototype.decorate = function (p, sq) {
    var code = +p.dataset.code;
    p.classList.toggle('sealed', E.sealedAt(code, sq));
    p.classList.toggle('mine', !!this.opts.interactive && (code > 0 ? 1 : -1) === this.userSide);
    var name = (code > 0 ? 'White ' : 'Black ') + NAMES[Math.abs(code)].toLowerCase() + ' on ' + E.sqName(sq);
    p.setAttribute('aria-label', name);
  };

  // full redraw without animation (new game, undo, load)
  Board.prototype.setPosition = function (pos) {
    this.pos = pos;
    this.closePicker();
    var keep = {};
    for (var sq = 0; sq < 64; sq++) {
      var code = pos.board[sq], cur = this.map[sq];
      if (code === 0) continue;
      if (cur && +cur.dataset.code === code) { keep[sq] = cur; delete this.map[sq]; }
    }
    for (var k in this.map) if (Object.prototype.hasOwnProperty.call(this.map, k)) this.map[k].remove();
    this.map = keep;
    for (sq = 0; sq < 64; sq++) {
      var c = pos.board[sq];
      if (c === 0) continue;
      if (!this.map[sq]) this.map[sq] = this.makePiece(c, sq);
      this.decorate(this.map[sq], sq);
    }
    this.refreshGhosts();
    this.refreshMarks();
  };

  Board.prototype.refreshGhosts = function () {
    if (!this.pos) return;
    for (var sq = 0; sq < 64; sq++) {
      var s = this.sqEls[sq], g = s.querySelector('.ghost');
      var want = 0;
      var hw = E.HOME_W[sq], hb = E.HOME_B[sq];
      if (this.pos.board[sq] === 0) want = hw ? hw : (hb ? -hb : 0);
      if (!want) { if (g) g.remove(); continue; }
      if (g && +g.dataset.code === want) continue;
      if (g) g.remove();
      g = el('div', 'ghost', P.svg(Math.abs(want), want > 0 ? 1 : -1, 'ghost'));
      g.dataset.code = String(want);
      if ((want > 0 ? 1 : -1) !== this.userSide) g.style.opacity = '0.22';
      s.appendChild(g);
    }
  };

  // animate one move. `d` is pos.describe(move) taken BEFORE the move; `pos` is the position AFTER it.
  Board.prototype.playMove = function (d, pos) {
    var self = this;
    this.pos = pos;
    this.closePicker();
    this.clearSelection();
    if (d.pass) { this.lastMove = null; this.refreshMarks(); return 300; }
    var p = this.map[d.from];
    if (d.recall) {
      if (p) {
        p.classList.add('recalled');
        delete this.map[d.from];
        setTimeout(function () { p.remove(); }, 560);
      }
      this.fx(d.from, 'ring', 'var(--rally)');
    } else {
      var victim = this.map[d.to];
      if (victim && victim !== p) {
        victim.classList.add('banished');
        setTimeout(function () { victim.remove(); }, 560);
        this.fx(d.to, 'spark', 'var(--orchid)');
      }
      if (p) {
        delete this.map[d.from];
        this.map[d.to] = p;
        p.classList.remove('dragging');
        p.style.removeProperty('translate');
        // longer trips take a little longer, and every piece lifts off the board as it travels
        var df = Math.abs((d.to & 7) - (d.from & 7)), dr = Math.abs((d.to >> 3) - (d.from >> 3));
        var dur = Math.min(0.46, 0.22 + 0.035 * Math.max(df, dr));
        p.style.setProperty('--dur', dur + 's');
        p.classList.toggle('leap', Math.abs(d.piece) === 2);
        p.classList.remove('moving'); void p.offsetWidth;
        p.classList.add('moving');
        clearTimeout(p._moveTimer);
        p._moveTimer = setTimeout(function () { p.classList.remove('moving', 'leap'); }, dur * 1000 + 60);
        this.place(p, d.to);
        this.decorate(p, d.to);
        if (d.seals) {
          setTimeout(function () {
            p.classList.add('just-sealed');
            self.fx(d.to, 'ring', 'var(--gilt)');
            self.fx(d.to, 'spark', 'var(--gilt)');
            setTimeout(function () { p.classList.remove('just-sealed'); }, 900);
          }, 260);
        }
      }
      if (d.rally) {
        var risen = this.makePiece(d.color * d.rally, d.from);
        risen.classList.add('rising');
        this.map[d.from] = risen;
        this.decorate(risen, d.from);
        this.fx(d.from, 'ring', 'var(--rally)');
        setTimeout(function () { risen.classList.remove('rising'); }, 800);
      }
    }
    // re-sync anything the animation did not cover
    for (var sq = 0; sq < 64; sq++) {
      var code = pos.board[sq], cur = this.map[sq];
      if (code === 0 && cur && !cur.classList.contains('banished') && !cur.classList.contains('recalled')) { cur.remove(); delete this.map[sq]; }
      else if (code !== 0 && (!cur || +cur.dataset.code !== code)) {
        if (cur) cur.remove();
        this.map[sq] = this.makePiece(code, sq);
      }
      if (this.map[sq]) this.decorate(this.map[sq], sq);
    }
    this.lastMove = d.recall ? { from: d.from, to: d.from } : { from: d.from, to: d.to };
    this.refreshGhosts();
    this.refreshMarks();
    return d.seals || d.rally ? 650 : 360;
  };

  Board.prototype.fx = function (sq, kind, color) {
    var c = this.xy(sq), f = el('div', 'fx ' + kind);
    f.style.setProperty('--x', c.x);
    f.style.setProperty('--y', c.y);
    f.style.setProperty('--c', color);
    if (kind === 'spark') {
      var html = '';
      for (var i = 0; i < 10; i++) {
        var a = (i / 10) * Math.PI * 2 + Math.random() * 0.4, r = 40 + Math.random() * 40;
        html += '<i style="--dx:' + (Math.cos(a) * r).toFixed(1) + 'px;--dy:' + (Math.sin(a) * r).toFixed(1) + 'px"></i>';
      }
      f.innerHTML = html;
    }
    this.node.appendChild(f);
    setTimeout(function () { f.remove(); }, 1000);
  };

  Board.prototype.wave = function () {
    var w = this.waveEl;
    w.classList.remove('go');
    void w.offsetWidth;
    w.classList.add('go');
  };

  // ---- marks: last move, check, hint, selection --------------------------------------------
  Board.prototype.refreshMarks = function () {
    for (var i = 0; i < 64; i++) this.sqEls[i].classList.remove('last', 'hint-from', 'hint-to', 'shield-mark');
    if (this.lastMove) {
      this.sqEls[this.lastMove.from].classList.add('last');
      this.sqEls[this.lastMove.to].classList.add('last');
    }
    for (var k in this.map) if (Object.prototype.hasOwnProperty.call(this.map, k)) this.map[k].classList.remove('in-check');
    if (this.pos) {
      var side = this.pos.side, ks = this.pos.kings[side === 1 ? 0 : 1];
      if (ks >= 0 && this.pos.inCheck(side) && this.map[ks]) this.map[ks].classList.add('in-check');
    }
    this.drawArrow();
  };

  Board.prototype.showHint = function (m) {
    this.hint = m ? E.decode(m) : null;
    this.refreshMarks();
    if (this.hint) {
      this.sqEls[this.hint.from].classList.add('hint-from');
      this.sqEls[this.hint.recall ? this.hint.from : this.hint.to].classList.add('hint-to');
    }
  };

  Board.prototype.drawArrow = function () {
    var svg = this.arrows;
    svg.innerHTML = '';
    var h = this.hint;
    if (!h || h.recall || h.pass) return;
    var a = this.xy(h.from), b = this.xy(h.to);
    var x1 = a.x * 100 + 50, y1 = a.y * 100 + 50, x2 = b.x * 100 + 50, y2 = b.y * 100 + 50;
    var ang = Math.atan2(y2 - y1, x2 - x1), len = 26;
    var tx = x2 - Math.cos(ang) * 18, ty = y2 - Math.sin(ang) * 18;
    var p1 = (tx - Math.cos(ang - 0.45) * len) + ',' + (ty - Math.sin(ang - 0.45) * len);
    var p2 = (tx - Math.cos(ang + 0.45) * len) + ',' + (ty - Math.sin(ang + 0.45) * len);
    svg.innerHTML = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + (tx - Math.cos(ang) * 14) + '" y2="' + (ty - Math.sin(ang) * 14) + '" style="stroke-width:14"/>' +
      '<polygon points="' + tx + ',' + ty + ' ' + p1 + ' ' + p2 + '"/>';
  };

  Board.prototype.setLegal = function (moves, enabled) {
    this.legal = moves || [];
    this.enabled = !!enabled;
    this.byFrom = {};
    for (var i = 0; i < this.legal.length; i++) {
      var m = this.legal[i], d = E.decode(m);
      if (d.pass) continue;
      (this.byFrom[d.from] = this.byFrom[d.from] || []).push(m);
    }
    if (!this.enabled) this.clearSelection();
  };

  Board.prototype.clearSelection = function () {
    if (this.selected >= 0 && this.map[this.selected]) this.map[this.selected].classList.remove('selected');
    this.selected = -1;
    for (var i = 0; i < 64; i++) this.sqEls[i].classList.remove('sel', 'target', 'take', 'seal', 'shield-mark');
    if (this.opts.onSelect) this.opts.onSelect(-1, []);
  };

  Board.prototype.select = function (sq) {
    this.clearSelection();
    var list = this.byFrom[sq];
    if (!list || !list.length) return false;
    this.selected = sq;
    this.sqEls[sq].classList.add('sel');
    if (this.map[sq]) this.map[sq].classList.add('selected');
    var pos = this.pos, piece = pos.board[sq];
    for (var i = 0; i < list.length; i++) {
      var d = E.decode(list[i]);
      if (d.recall) continue;
      var s = this.sqEls[d.to];
      s.classList.add('target');
      if (pos.board[d.to] !== 0) s.classList.add('take');
      if (E.sealedAt(piece, d.to)) s.classList.add('seal');
    }
    // when a royal is picked, show which enemy comrades are shielded from it
    var t = Math.abs(piece);
    if (t === 5 || t === 6) {
      for (var q = 0; q < 64; q++) {
        var c = pos.board[q];
        if (c * piece < 0 && Math.abs(c) < 5 && !E.sealedAt(c, q) && pos.shielded(q)) this.sqEls[q].classList.add('shield-mark');
      }
    }
    if (this.opts.onSelect) this.opts.onSelect(sq, list);
    if (root.MateCheckSound) root.MateCheckSound.sfx('select');
    return true;
  };

  // ---- turning input into moves -------------------------------------------------------------
  Board.prototype.tryMove = function (from, to) {
    var list = this.byFrom[from] || [], cands = [];
    for (var i = 0; i < list.length; i++) {
      var d = E.decode(list[i]);
      if (!d.recall && d.to === to) cands.push(list[i]);
    }
    if (!cands.length) return false;
    if (cands.length === 1) { this.commit(cands[0]); return true; }
    var auto = this.opts.autoRally && this.opts.autoRally();
    if (auto && this.opts.pickRally) { this.commit(this.opts.pickRally(cands)); return true; }
    this.openPicker(from, to, cands);
    return true;
  };

  Board.prototype.commit = function (m) {
    this.closePicker();
    if (this.opts.onMove) this.opts.onMove(m);
  };

  Board.prototype.openPicker = function (from, to, cands) {
    var self = this;
    this.closePicker();
    var best = this.opts.pickRally ? this.opts.pickRally(cands) : cands[cands.length - 1];
    var c = this.xy(from), color = this.pos.side;
    var box = el('div', 'rally-picker' + (c.y >= 5 ? ' above' : ''));
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose who rises on ' + E.sqName(from));
    box.style.left = ((c.x + 0.5) * 12.5) + '%';
    box.style.top = ((c.y + (c.y >= 5 ? 0 : 1)) * 12.5) + '%';
    var html = '<p>Who rises on ' + E.sqName(from) + '?</p><div class="opts">';
    var noneMove = 0, k = 0, keyMap = {};
    for (var i = 0; i < cands.length; i++) {
      var r = (cands[i] >> 12) & 7;
      if (!r) { noneMove = cands[i]; continue; }
      k++;
      keyMap[k] = cands[i];
      html += '<button type="button" class="rally-opt' + (cands[i] === best ? ' best' : '') + '" data-m="' + cands[i] + '"><kbd>' + k + '</kbd>' +
        P.svg(r, color) + '<small>' + NAMES[r] + '</small></button>';
    }
    html += '</div>';
    if (noneMove) html += '<button type="button" class="rally-none" data-m="' + noneMove + '">Nobody rises this time</button>';
    box.innerHTML = html;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]');
      if (b) self.commit(+b.dataset.m);
    });
    this.node.appendChild(box);
    this.sqEls[to].classList.add('sel');
    this.picker = { box: box, keys: keyMap, none: noneMove, best: best };
    var first = box.querySelector('.best') || box.querySelector('.rally-opt');
    if (first) first.focus({ preventScroll: true });
    this.pickerKey = function (e) {
      if (!self.picker) return;
      if (e.key === 'Escape') { e.preventDefault(); self.closePicker(); self.clearSelection(); }
      else if (e.key === 'Enter' && document.activeElement && !document.activeElement.dataset.m) { e.preventDefault(); self.commit(self.picker.best); }
      else if (e.key === '0' && self.picker.none) { self.commit(self.picker.none); }
      else if (self.picker.keys[e.key]) { self.commit(self.picker.keys[e.key]); }
    };
    document.addEventListener('keydown', this.pickerKey);
  };

  Board.prototype.closePicker = function () {
    if (!this.picker) return;
    this.picker.box.remove();
    this.picker = null;
    document.removeEventListener('keydown', this.pickerKey);
  };

  Board.prototype.squareAt = function (clientX, clientY) {
    var r = this.node.getBoundingClientRect();
    var x = Math.floor((clientX - r.left) / r.width * 8), y = Math.floor((clientY - r.top) / r.height * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
    var f = this.flipped ? 7 - x : x, rk = this.flipped ? y : 7 - y;
    return rk * 8 + f;
  };

  Board.prototype.bindInput = function () {
    var self = this;
    this.node.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (self.picker && !e.target.closest('.rally-picker')) { self.closePicker(); self.clearSelection(); return; }
      if (e.target.closest('.rally-picker')) return;
      if (!self.enabled) return;
      var sq = self.squareAt(e.clientX, e.clientY);
      if (sq < 0) return;
      if (self.selected >= 0 && sq !== self.selected && self.tryMove(self.selected, sq)) { e.preventDefault(); return; }
      var own = self.byFrom[sq];
      if (own && own.length) {
        e.preventDefault();
        var wasSelected = self.selected === sq;
        self.select(sq);
        var p = self.map[sq];
        if (p) {
          self.drag = { sq: sq, p: p, x0: e.clientX, y0: e.clientY, moved: false, wasSelected: wasSelected, id: e.pointerId };
          try { self.node.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
        }
      } else if (self.selected >= 0) {
        self.clearSelection();
        if (root.MateCheckSound) root.MateCheckSound.sfx('invalid');
      }
    });
    this.node.addEventListener('pointermove', function (e) {
      var d = self.drag;
      if (!d) return;
      var dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      d.moved = true;
      d.p.classList.add('dragging');
      d.p.style.translate = dx + 'px ' + dy + 'px';
      self.node.classList.add('drag-over');
    });
    function end(e) {
      var d = self.drag;
      if (!d) return;
      self.drag = null;
      self.node.classList.remove('drag-over');
      try { self.node.releasePointerCapture(d.id); } catch (err) { /* ignore */ }
      if (d.moved) {
        d.p.classList.remove('dragging');
        d.p.style.removeProperty('translate');
        var to = e.type === 'pointercancel' ? -1 : self.squareAt(e.clientX, e.clientY);
        if (to >= 0 && to !== d.sq && self.tryMove(d.sq, to)) return;
        if (to !== d.sq && root.MateCheckSound) root.MateCheckSound.sfx('invalid');
      } else if (d.wasSelected) {
        self.clearSelection();
      }
    }
    this.node.addEventListener('pointerup', end);
    this.node.addEventListener('pointercancel', end);
    // keyboard: arrows move a focus ring, Enter/Space selects or moves
    this.node.tabIndex = 0;
    this.node.setAttribute('role', 'application');
    this.node.setAttribute('aria-label', 'MateCheck board. Use arrow keys to move the cursor, Enter to pick a piece or a square.');
    this.cursor = -1;
    this.node.addEventListener('keydown', function (e) {
      if (self.picker) return;
      var keys = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (keys[e.key]) {
        e.preventDefault();
        if (self.cursor < 0) self.cursor = self.userSide === 1 ? 4 : 60;
        var c = self.xy(self.cursor), nx = Math.max(0, Math.min(7, c.x + keys[e.key][0])), ny = Math.max(0, Math.min(7, c.y + keys[e.key][1]));
        var f = self.flipped ? 7 - nx : nx, rk = self.flipped ? ny : 7 - ny;
        self.setCursor(rk * 8 + f);
      } else if ((e.key === 'Enter' || e.key === ' ') && self.cursor >= 0 && self.enabled) {
        e.preventDefault();
        if (self.selected >= 0 && self.cursor !== self.selected && self.tryMove(self.selected, self.cursor)) return;
        if (self.byFrom[self.cursor]) self.select(self.cursor); else self.clearSelection();
      } else if (e.key === 'Escape') {
        self.clearSelection();
      }
    });
  };

  Board.prototype.setCursor = function (sq) {
    if (this.cursor >= 0) this.sqEls[this.cursor].style.outline = '';
    this.cursor = sq;
    var s = this.sqEls[sq];
    s.style.outline = '3px solid var(--rally)';
    s.style.outlineOffset = '-3px';
  };

  root.MateCheckBoard = Board;
}(typeof self !== 'undefined' ? self : this));
