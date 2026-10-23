/*
 * MateCheck - piece artwork
 * Copyright (c) 2026 Swayam Shakya. MIT License.
 *
 * Hand-drawn SVG pieces on a 100x100 grid. Ivory pieces get a plum outline,
 * onyx pieces get a gilt edge. Gradients live in one hidden <svg> that is
 * injected once, so every piece can point at them.
 */
(function (root) {
  'use strict';

  var BASE = '<path d="M27 80h46l5 7H22z"/><path d="M20 87h60a3 3 0 0 1 3 3v3H17v-3a3 3 0 0 1 3-3z"/>';

  var SHAPES = {
    1: { // pawn
      body: '<circle cx="50" cy="27" r="11.5"/>' +
            '<path d="M38 40h24a3.2 3.2 0 0 1 0 6.4H38a3.2 3.2 0 0 1 0-6.4z"/>' +
            '<path d="M42.5 46.4C42 60 36.5 70 31 80h38c-5.5-10-11-20-11.5-33.6z"/>' + BASE,
      detail: '<path d="M44 22a7 7 0 0 1 6-4" />'
    },
    2: { // knight
      body: '<path d="M69 80H30c0-10 4.5-18 12.5-25-6 1.4-12 3-16.4.2-5.3-3.3-5.6-8.8-1.5-12.8L39.5 28c1-8.2 6.2-14.4 13.3-16.4l3.2 6.2c13.3 3 21.2 16 19.2 32.2C74.2 63 70 70.6 69 80z"/>' + BASE,
      detail: '<circle cx="43.5" cy="31" r="2.6" class="fill"/><circle cx="28.5" cy="48.8" r="1.6" class="fill"/>' +
              '<path d="M57.5 21c8 5.6 11.6 15.8 10.6 27.4"/><path d="M47 54.5c4-1.6 7.4-4.6 9.4-8.6"/>'
    },
    3: { // bishop
      body: '<circle cx="50" cy="12.5" r="5.2"/>' +
            '<path d="M50 18c12.4 7.6 16.6 21.6 10.4 34H39.6C33.4 39.6 37.6 25.6 50 18z"/>' +
            '<path d="M37 52h26a3.2 3.2 0 0 1 0 6.4H37a3.2 3.2 0 0 1 0-6.4z"/>' +
            '<path d="M41.5 58.4C41 66.8 36.5 73.6 32 80h36c-4.5-6.4-9-13.2-9.5-21.6z"/>' + BASE,
      detail: '<path d="M55.5 28.5 45.5 41"/>'
    },
    4: { // rook
      body: '<path d="M29 15h9v6.5h7V15h10v6.5h7V15h9v15l-6.5 6.5h-29L29 30z"/>' +
            '<path d="M36.5 36.5h27L66 75H34z"/>' +
            '<path d="M31 75h38v5H31z"/>' + BASE,
      detail: '<path d="M37 45h26"/><path d="M50 52v12"/>'
    },
    5: { // queen
      body: '<circle cx="21" cy="24" r="4.6"/><circle cx="35.5" cy="15.5" r="4.6"/><circle cx="50" cy="12" r="4.8"/>' +
            '<circle cx="64.5" cy="15.5" r="4.6"/><circle cx="79" cy="24" r="4.6"/>' +
            '<path d="M21.5 28 31.5 56h37l10-28-14.5 14L59 20.5l-9 19.5-9-19.5-5.5 21.5z"/>' +
            '<path d="M31 56h38a3.2 3.2 0 0 1 0 6.4H31a3.2 3.2 0 0 1 0-6.4z"/>' +
            '<path d="M35.5 62.4c0 7-3.4 12.4-7.5 17.6h44c-4.1-5.2-7.5-10.6-7.5-17.6z"/>' + BASE,
      detail: '<circle cx="50" cy="59.2" r="2.2" class="gem"/>'
    },
    6: { // king
      body: '<path d="M46 4h8v7.5h7.5v8H54V27h-8v-7.5h-7.5v-8H46z"/>' +
            '<path d="M29.5 46C25.8 33.5 36 25.6 50 28c14-2.4 24.2 5.5 20.5 18z"/>' +
            '<path d="M30 46h40a3.2 3.2 0 0 1 0 6.4H30a3.2 3.2 0 0 1 0-6.4z"/>' +
            '<path d="M35 52.4C35 64 31 72.4 27 80h46c-4-7.6-8-16-8-27.6z"/>' + BASE,
      detail: '<path d="M38 38c7-3.4 17-3.4 24 0"/><circle cx="50" cy="49.2" r="2.2" class="gem"/>'
    }
  };

  var NAMES = ['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];

  function ensureDefs() {
    if (typeof document === 'undefined' || document.getElementById('mc-piece-defs')) return;
    var holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.setAttribute('id', 'mc-piece-defs');
    holder.setAttribute('aria-hidden', 'true');
    holder.setAttribute('width', '0');
    holder.setAttribute('height', '0');
    holder.style.position = 'absolute';
    holder.innerHTML =
      '<defs>' +
      '<linearGradient id="mc-ivory" x1="0" y1="0" x2="0.35" y2="1">' +
      '<stop offset="0" stop-color="#fffaf0"/><stop offset="0.55" stop-color="#f6e5c2"/><stop offset="1" stop-color="#dcb979"/></linearGradient>' +
      '<linearGradient id="mc-onyx" x1="0" y1="0" x2="0.35" y2="1">' +
      '<stop offset="0" stop-color="#5a3a78"/><stop offset="0.5" stop-color="#2a1340"/><stop offset="1" stop-color="#12071c"/></linearGradient>' +
      '<linearGradient id="mc-ghost" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#f6c453" stop-opacity="0.55"/><stop offset="1" stop-color="#f6c453" stop-opacity="0.2"/></linearGradient>' +
      '</defs>';
    document.body.insertBefore(holder, document.body.firstChild);
  }

  // type: 1..6, color: 1 white / -1 black, variant: '' | 'ghost'
  function svg(type, color, variant) {
    var shape = SHAPES[type];
    if (!shape) return '';
    var ghost = variant === 'ghost';
    var cls = ghost ? 'mc-svg ghost' : (color > 0 ? 'mc-svg ivory' : 'mc-svg onyx');
    return '<svg class="' + cls + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<g class="body">' + shape.body + '</g>' +
      (ghost ? '' : '<g class="detail">' + shape.detail + '</g>') +
      '</svg>';
  }

  root.MateCheckPieces = { svg: svg, ensureDefs: ensureDefs, NAMES: NAMES };
}(typeof self !== 'undefined' ? self : this));
