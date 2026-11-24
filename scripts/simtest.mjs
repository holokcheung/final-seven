// Headless check of the match simulation: plays computer-vs-computer matches
// and fails if anything breaks a rule of the game or the numbers go bad.
//   npm test            20 matches
//   npm test -- 50      50 matches

import { createMatch, step } from '../src/sim/match.js';
import { STEP, HALF_L, AREA_R, goalDist } from '../src/sim/core.js';
import { TEAMS } from '../src/data/teams.js';

const matches = Number(process.argv[2]) || 20;
const halfSeconds = 300;
const fail = (msg) => {
  console.error('FAIL: ' + msg);
  process.exit(1);
};

const total = { goals: [0, 0], shots: [0, 0], saves: [0, 0], steals: [0, 0], events: {} };
for (let seed = 1; seed <= matches; seed++) {
  const s = createMatch({ teams: TEAMS, seed, humanTeam: null, halfSeconds });
  let steps = 0;
  while (s.phase !== 'fulltime') {
    step(s, STEP);
    if (++steps > 250000) fail(`seed ${seed}: match never finished`);
    for (const e of s.events) total.events[e.type] = (total.events[e.type] || 0) + 1;
    s.events.length = 0;

    const b = s.ball;
    if (![b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite)) fail(`seed ${seed}: ball position is not a number`);
    if (Math.abs(b.x) > 30 || Math.abs(b.z) > 20 || b.y > 30) fail(`seed ${seed}: ball left the arena`);
    for (const p of s.players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) fail(`seed ${seed}: player ${p.id} position is not a number`);
      const ownGx = -s.teams[p.team].dir * HALF_L;
      if (p.role === 'GK') {
        if (goalDist(p.x, p.z, ownGx) > AREA_R) fail(`seed ${seed}: keeper ${p.id} left the goal area`);
      } else if (goalDist(p.x, p.z, -HALF_L) < AREA_R - 0.05 || goalDist(p.x, p.z, HALF_L) < AREA_R - 0.05) {
        fail(`seed ${seed}: court player ${p.id} (${p.role}) is inside a goal area`);
      }
    }
    if (b.holder != null && !s.players[b.holder].hasBall) fail(`seed ${seed}: ball holder flag out of sync`);
    if (s.players.filter((p) => p.hasBall).length > 1) fail(`seed ${seed}: two players hold the ball`);
  }
  for (const t of [0, 1]) {
    total.goals[t] += s.score[t];
    total.shots[t] += s.stats.shots[t];
    total.saves[t] += s.stats.saves[t];
    total.steals[t] += s.stats.steals[t];
  }
  if (seed <= 8) console.log(`seed ${String(seed).padStart(2)}: DEN ${s.score[0]} - ${s.score[1]} FRA   shots ${s.stats.shots.join('/')}  saves ${s.stats.saves.join('/')}`);
}

const avg = (a) => a.map((v) => (v / matches).toFixed(1)).join(' / ');
const shots = total.shots[0] + total.shots[1];
const goals = total.goals[0] + total.goals[1];
console.log(`\n${matches} matches, ${(2 * halfSeconds) / 60} min each (DEN / FRA per match)`);
console.log(`goals  ${avg(total.goals)}`);
console.log(`shots  ${avg(total.shots)}`);
console.log(`saves  ${avg(total.saves)}`);
console.log(`steals ${avg(total.steals)}`);
console.log(`shots that score: ${((goals / shots) * 100).toFixed(0)}%`);
console.log('events per match:', Object.fromEntries(Object.entries(total.events).map(([k, v]) => [k, +(v / matches).toFixed(1)])));

if (goals === 0) fail('nobody ever scored');
if (total.goals[0] === 0 || total.goals[1] === 0) fail('one team never scored');
console.log('\nOK');
