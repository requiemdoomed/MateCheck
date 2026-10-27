// Every lesson must load, be legal, and (if it has a task) be solvable in one move.
'use strict';
const E = require('../assets/js/engine.js');
global.self = global;
global.MateCheckEngine = E;
global.MateCheckSound = {};
require('../assets/js/tutorial.js');
const LESSONS = global.MateCheckTutorial.LESSONS;
let bad = 0;
LESSONS.forEach((L, i) => {
  const pos = new E.Position().load(L.fen);
  const errs = [];
  if (pos.kings[0] < 0 || pos.kings[1] < 0) errs.push('missing king');
  for (const c of [1, -1]) {
    const n = pos.piecesOnBoard(c) + pos.reserveOf(c).total;
    if (n !== 16) errs.push((c > 0 ? 'white' : 'black') + ' has ' + n + ' pieces');
  }
  if (pos.inCheck(-pos.side)) errs.push('side not to move is in check');
  let solver = '';
  if (L.goal) {
    for (const m of pos.legalMoves([])) {
      const d = pos.describe(m); pos.make(m); const ok = L.goal(d, pos); pos.unmake();
      if (ok) { solver = pos.notation(m); break; }
    }
    if (!solver && !/two moves/.test(L.task)) errs.push('no one-move solution');
  }
  if (errs.length) bad++;
  console.log(`${String(i + 1).padStart(2)} ${L.title.padEnd(32)} ${errs.length ? 'PROBLEM: ' + errs.join('; ') : 'ok'} ${solver ? '(e.g. ' + solver + ')' : ''}`);
});
// the gate lesson needs two moves: check it can be done
{
  const L = LESSONS.find(l => /gate/.test(l.title));
  const pos = new E.Position().load(L.fen);
  const a = pos.parseMove('Rd3-d1'); pos.make(a); pos.make(E.PASS);
  const b = pos.parseMove('Rd1-a1');
  const d = pos.describe(b);
  console.log('   gate lesson second move seals: ' + (!!b && L.goal(d, pos)));
  if (!b || !L.goal(d, pos)) bad++;
}
console.log(bad ? bad + ' problem(s) found.' : 'All ' + LESSONS.length + ' lessons load and can be solved.');
process.exitCode = bad ? 1 : 0;
