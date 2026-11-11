// Self-play arena.  node tests/selfplay.js [games] [whiteLevel] [blackLevel] [battlefield]
'use strict';
const E = require('../assets/js/engine.js');
const B = require('../assets/js/brain.js');
let weights = null;
try { weights = require('../assets/js/weights.js'); } catch (e) { /* first run */ }
const brain = B.factory(E, weights && weights.weights);

const games = parseInt(process.argv[2] || '6', 10);
const wl = process.argv[3] || 'expert';
const bl = process.argv[4] || 'expert';
const field = process.argv[5] || 'all';
const verbose = process.env.VERBOSE === '1';

const tally = { white: 0, black: 0, draw: 0 };
const reasons = {};
let plies = 0, slowest = 0, totalMs = 0, moveCount = 0, maxDepthSum = 0;
const ids = field === 'all' ? Object.keys(E.BATTLEFIELDS) : [field];

for (let g = 0; g < games; g++) {
  const id = ids[g % ids.length];
  const pos = E.newGame(id);
  const line = [];
  let oc;
  while (!(oc = pos.outcome()).over) {
    const lvl = pos.side === E.WHITE ? wl : bl;
    const r = brain.think(pos, { level: lvl, seed: 1000 * g + pos.ply + 1 });
    if (!r.move) throw new Error('no move returned at ' + pos.toString());
    line.push(pos.notation(r.move));
    totalMs += r.ms; moveCount++; maxDepthSum += r.depth;
    if (r.ms > slowest) slowest = r.ms;
    pos.make(r.move);
  }
  plies += pos.ply;
  reasons[oc.reason] = (reasons[oc.reason] || 0) + 1;
  if (oc.winner === E.WHITE) tally.white++; else if (oc.winner === E.BLACK) tally.black++; else tally.draw++;
  console.log(`game ${g + 1} [${id}] ${oc.reason} -> ${oc.winner === 1 ? 'white' : oc.winner === -1 ? 'black' : 'draw'} in ${pos.ply} plies; formation W${pos.formationScore(1)} B${pos.formationScore(-1)}`);
  if (verbose) console.log('   ' + line.join('  '));
}
console.log('\nresult', tally, reasons);
console.log('avg plies', (plies / games).toFixed(1), '| avg ms/move', (totalMs / moveCount).toFixed(0), '| slowest', slowest, '| avg depth', (maxDepthSum / moveCount).toFixed(2));
