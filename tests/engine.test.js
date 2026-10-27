// Engine checks. Run with:  node tests/engine.test.js
'use strict';
const E = require('../assets/js/engine.js');
const { Position, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } = E;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; return; }
  failed++;
  console.log('  FAIL: ' + name + (extra ? '  ->  ' + extra : ''));
}

function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.legalMoves([]);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) { pos.make(m); n += perft(pos, depth - 1); pos.unmake(); }
  return n;
}

function snapshot(pos) {
  return pos.toString() + '|' + pos.hashLo + ':' + pos.hashHi + '|' + pos.kings.join(',') + '|' + pos.clock;
}

// --- every battlefield starts legal, nobody in check, queens not hanging
for (const id of Object.keys(E.BATTLEFIELDS)) {
  const p = E.newGame(id);
  check(id + ': white not in check', !p.inCheck(WHITE));
  check(id + ': black not in check', !p.inCheck(BLACK));
  const wq = p.board.indexOf(QUEEN), bq = p.board.indexOf(-QUEEN);
  check(id + ': white queen not attacked', !p.attacked(wq, BLACK));
  check(id + ': black queen not attacked', !p.attacked(bq, WHITE));
  check(id + ': has moves', p.legalMoves([]).length > 0);
}

// --- text round trip
{
  const p = E.newGame('crossroads');
  const t = p.toString();
  const q = new Position().load(t);
  check('round trip text', q.toString() === t, q.toString());
  check('round trip hash', q.hashLo === p.hashLo && q.hashHi === p.hashHi);
}

// --- perft stays identical after make/unmake noise
{
  const p = E.newGame('last-stand');
  const before = snapshot(p);
  const n3 = perft(p, 3);
  check('perft leaves position untouched', snapshot(p) === before);
  console.log('  perft(last-stand, 1..3) =', perft(p, 1), perft(p, 2), n3);
}

// --- random games: hash consistency + rules invariants
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }
const reasons = {};
let passes = 0;
let totalPly = 0, games = 0;
for (let g = 0; g < 400; g++) {
  const rand = rng(1234 + g);
  const ids = Object.keys(E.BATTLEFIELDS);
  const p = E.newGame(ids[g % ids.length]);
  for (let ply = 0; ply < 300; ply++) {
    const oc = p.outcome();
    if (oc.over) { reasons[oc.reason] = (reasons[oc.reason] || 0) + 1; break; }
    const moves = p.legalMoves([]);
    // bias toward rallies so we actually reach crowded boards
    const rallies = moves.filter(m => (m >> 12) & 7);
    const pool = rallies.length && rand() < 0.6 ? rallies : moves;
    const m = pool[Math.floor(rand() * pool.length)];
    if (m === E.PASS) passes++;
    // nobody may ever be checkmated
    if (p.inCheck(p.side) && moves[0] === E.PASS) check('checkmate reached', false, p.toString());
    const before = snapshot(p);
    const mover = p.side;
    const d = p.describe(m);
    p.make(m);
    // the mover's king is never left in check
    if (p.inCheck(mover)) { check('king left in check', false, p.toString()); }
    // incremental hash equals full rehash
    const lo = p.hashLo, hi = p.hashHi;
    p.rehash();
    if (lo !== p.hashLo || hi !== p.hashHi) check('hash drift', false, p.toString());
    // rallies only happen on the mover's muster ground
    if (d.rally && !E.inMuster(mover, d.from)) check('rally off the muster ground', false);
    // piece counts: board + reserve = 16 per side
    for (const c of [WHITE, BLACK]) {
      let n = p.piecesOnBoard(c) + p.reserveOf(c).total;
      if (n !== 16) check('piece count ' + c, false, n + ' ' + p.toString());
    }
    p.unmake();
    if (snapshot(p) !== before) check('unmake restores', false, before + ' vs ' + snapshot(p));
    p.make(m);
  }
  totalPly += p.ply; games++;
}
console.log('  random games:', games, 'avg plies', (totalPly / games).toFixed(1), reasons, 'passes', passes);

// --- sealed pieces never move and cannot be banished
{
  const p = new Position().load('4k3/8/8/8/8/8/4P3/3qK3 b P7N2L1D1R2Q1 P8N2L1D1R2Q0 0 200');
  // black queen on d1 next to a sealed white pawn on e2 - it may not take it
  const moves = p.legalMoves([]);
  const takesE2 = moves.some(m => ((m >> 6) & 63) === E.parseSq('e2') && (m & 63) === E.parseSq('d1'));
  check('sealed pawn cannot be banished', !takesE2);
  p.side = WHITE; p.rehash();
  const wm = p.legalMoves([]);
  check('sealed pawn cannot move', !wm.some(m => (m & 63) === E.parseSq('e2')));
}

// --- pawns walk backwards, with the reverse double step from the 4th rank
{
  const p = new Position().load('4k3/8/8/8/3P4/8/8/4K3 w P7N2L1D1R2Q1 P8N2L1D1R2Q1 0 200');
  const targets = p.legalMoves([]).filter(m => (m & 63) === E.parseSq('d4') && !(m & E.RECALL)).map(m => E.sqName((m >> 6) & 63));
  const uniq = [...new Set(targets)].sort();
  check('pawn targets', JSON.stringify(uniq) === JSON.stringify(['c3', 'd2', 'd3', 'e3']), uniq.join(','));
}

// --- comrades never strike: a knight cannot land on an enemy piece, a queen can
{
  const p = new Position().load('4k3/8/8/3n4/8/4N3/8/3QK3 w P8N1L1D1R2Q0 P8N1L1D1R2Q1 0 200');
  const knightTakes = p.legalMoves([]).some(m => (m & 63) === E.parseSq('e3') && ((m >> 6) & 63) === E.parseSq('d5'));
  check('knight cannot banish', !knightTakes);
  const p2 = new Position().load('4k3/8/8/3n4/8/8/8/3QK3 w P8N2L1D1R2Q0 P8N1L1D1R2Q1 0 200');
  const queenTakes = p2.legalMoves([]).some(m => (m & 63) === E.parseSq('d1') && ((m >> 6) & 63) === E.parseSq('d5'));
  check('queen can banish', queenTakes);
  // the same knight with a friend beside it is shielded
  const p3 = new Position().load('4k3/8/8/3np3/8/8/8/3QK3 w P8N2L1D1R2Q0 P7N1L1D1R2Q1 0 200');
  const shieldTake = p3.legalMoves([]).some(m => (m & 63) === E.parseSq('d1') && ((m >> 6) & 63) === E.parseSq('d5'));
  check('shielded comrade cannot be banished', !shieldTake);
  // squatters in enemy land get no shield
  const p4 = new Position().load('4k3/8/8/8/8/8/rr6/3QK3 w P8N2L1D1R2Q0 P8N2L1D1R0Q1 0 200');
  const evict = p4.legalMoves([]).some(m => (m & 63) === E.parseSq('d1') && ((m >> 6) & 63) === E.parseSq('b2') || (m & 63) === E.parseSq('d1') && ((m >> 6) & 63) === E.parseSq('a2'));
  check('squatters are never shielded', !p4.shielded(E.parseSq('a2')) && !p4.shielded(E.parseSq('b2')));
  check('a knight gives no check', !new Position().load('4k3/8/3N4/8/8/8/8/4K3 b P8N1L1D1R2Q1 P8N2L1D1R2Q1 0 200').inCheck(BLACK));
}

// --- bishops rise only on the colour of a bishop still in reserve
{
  const p = new Position().load('4k3/8/8/8/8/8/8/2Q1K3 w P8N2L0D1R2Q0 P8N2L1D1R2Q0 0 200');
  // queen leaves c1? that's a home rank - no rally there. Put the queen on c3 instead.
  p.load('4k3/8/8/8/8/2Q5/8/4K3 w P8N2L0D1R2Q0 P8N2L1D1R2Q0 0 200');
  // c3 is a dark square, the dark bishop is still in reserve
  const rallies = p.legalMoves([]).filter(m => (m & 63) === E.parseSq('c3') && ((m >> 12) & 7) === BISHOP);
  check('dark bishop may rise on dark square', rallies.length > 0);
  p.load('4k3/8/8/8/8/3Q4/8/4K3 w P8N2L0D1R2Q0 P8N2L1D1R2Q0 0 200');
  const r2 = p.legalMoves([]).filter(m => (m & 63) === E.parseSq('d3') && ((m >> 12) & 7) === BISHOP);
  check('light bishop gone, none may rise on light square', r2.length === 0);
}

// --- a pinned piece may still move if a comrade rises to keep the shield
{
  // white king e3, white knight e4, black queen e8: the knight is pinned
  const p = new Position().load('4q2k/8/8/8/4N3/4K3/8/8 w P8N1L1D1R2Q1 P8N2L1D1R2Q0 0 200');
  const nm = p.legalMoves([]).filter(m => (m & 63) === E.parseSq('e4') && !(m & E.RECALL));
  check('pinned knight needs a rally', nm.length > 0 && nm.every(m => ((m >> 12) & 7) !== 0));
  const recallKnight = p.legalMoves([]).some(m => (m & E.RECALL) && (m & 63) === E.parseSq('e4'));
  check('pinned knight cannot be recalled', !recallKnight);
}

// --- MateCheck: completing the formation wins on the spot
{
  // white is one move away: the knight on c3 hops home to b1
  const p = new Position().load('4k3/8/8/8/8/2N5/PPPPPPPP/R1BQKBNR w P0N0L0D0R0Q0 P8N2L1D1R2Q1 40 200');
  const m = p.parseMove('Nc3-b1');
  check('found the finishing move', m !== 0);
  p.make(m);
  const oc = p.outcome();
  check('MateCheck detected', oc.over && oc.reason === 'matecheck' && oc.winner === WHITE, JSON.stringify(oc));
}

// --- checkmate is outlawed: a move that would corner the king is not on the menu
{
  // black king h8 behind its sealed knight on g8, white king g6. Qd1-h5 would be mate.
  const p = new Position().load('6nk/8/6K1/8/8/8/8/3Q4 w P8N2L1D1R2Q0 P8N1L1D1R2Q0 30 200');
  const mate = p.legalMoves([]).some(m => (m & 63) === E.parseSq('d1') && ((m >> 6) & 63) === E.parseSq('h5'));
  check('mating move is illegal', !mate);
  const p2 = new Position().load('7k/8/6K1/8/8/8/8/3Q4 w P8N2L1D1R2Q0 P8N2L1D1R2Q0 30 200');
  check('the same check with an escape square is fine', p2.parseMove('Qd1-h5') !== 0);
}

// --- nobody enters the enemy court
{
  const p = new Position().load('4k3/8/3QN3/8/8/8/8/4K3 w P8N1L1D1R2Q0 P8N2L1D1R2Q1 0 200');
  const intoCourt = p.legalMoves([]).some(m => !(m & E.RECALL) && (((m >> 6) & 63) >> 3) >= 6);
  check('no white piece steps onto ranks 7-8', !intoCourt);
}

// --- kings never set foot in the enemy court
{
  const p = new Position().load('4k3/8/3K4/8/8/8/8/8 w P8N2L1D1R2Q1 P8N2L1D1R2Q1 0 200');
  const intoCourt = p.legalMoves([]).some(m => (m & 63) === E.parseSq('d6') && (((m >> 6) & 63) >> 3) >= 6);
  check('king stays out of the enemy home ranks', !intoCourt);
}

// --- a side with nothing to do passes instead of being stuck
{
  // black king a8 boxed by its own sealed... use a lone king walled in by white pieces it cannot take
  const p = new Position().load('8/8/8/8/8/8/PPP5/kPP5 b P3N2L1D1R2Q1 P8N2L1D1R2Q1 0 200');
  const ms = p.legalMoves([]);
  check('pass offered when nothing else is legal', ms.length === 1 && ms[0] === E.PASS, ms.map(m => p.notation(m)).join(' '));
}

// --- dawn decides on formation count
{
  const p = new Position().load('4k3/8/8/8/8/8/PP6/3QK3 b P6N2L1D1R2Q0 P8N2L1D1R2Q0 200 200');
  const oc = p.outcome();
  check('dawn verdict', oc.over && oc.reason === 'dawn' && oc.winner === WHITE, JSON.stringify(oc));
}

// --- the Grand Revival score: comrades risen + pieces home
{
  const p = new Position().load('4k3/8/8/8/8/8/PP6/3QK3 b P6N2L1D1R2Q0 P8N2L1D1R2Q0 200 200');
  check('revived comrades', p.revivedCount(WHITE) === 2 && p.revivedCount(BLACK) === 0, p.revivedCount(WHITE) + '/' + p.revivedCount(BLACK));
  check('revival score', p.revivalScore(WHITE) === 6 && p.revivalScore(BLACK) === 1, p.revivalScore(WHITE) + '/' + p.revivalScore(BLACK));
  const q = E.newGame('crossroads');
  check('revival starts at zero comrades', q.revivedCount(WHITE) === 0 && q.revivedCount(BLACK) === 0);
}

// --- notation round trip on random positions
{
  const p = E.newGame('long-road');
  const rand = rng(99);
  let ok = true;
  for (let i = 0; i < 80; i++) {
    const moves = p.legalMoves([]);
    if (!moves.length || p.outcome().over) break;
    for (const m of moves) {
      const back = p.parseMove(p.notation(m));
      if (back !== m) { ok = false; console.log('   notation mismatch', p.notation(m)); break; }
    }
    p.make(moves[Math.floor(rand() * moves.length)]);
  }
  check('notation round trip', ok);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
