// The match itself: state, rules, ball physics and player control.
// createMatch() builds a state object; step() advances it by one fixed time step.
// Things that happened (goal, whistle, save...) are pushed to state.events for
// the renderer, HUD and audio to react to.

import { HALF_L, HALF_W, GOAL_HALF, GOAL_H, AREA_R, GRAVITY, BALL_R, MAX_STEPS, STEP_LEN, HOLD_LIMIT, clamp, makeRng, goalDist } from './core.js';
import { KICKOFF, teamContext, aiMove, aiCarrier } from './ai.js';

const RUN = 5.0;
const SPRINT = 6.9;
const DRIBBLE = 6.2; // running while bouncing the ball
const AI_FAST = 6.0;
const ACCEL = 30;
const KEEPER_SPEED = 3.8;
const KEEPER_REACT = 0.24;
const KEEPER_REACH = 0.64; // metres either side of his body
const SKILL = [0.7, 1, 1.3]; // easy, normal, hard: scales the opponent's keeper, accuracy and steals
const BLOCK_CHANCE = 0.5;
const POWER_COST = 0.4; // stamina a power shot takes
const PASSIVE_LIMIT = 45; // seconds a team may keep the ball without shooting

export const NO_INPUT = Object.freeze({ mx: 0, mz: 0, sprint: false, passP: false, shootHeld: false, shootP: false, switchP: false });

const emit = (s, type, data) => s.events.push({ type, ...data });
const gauss = (s) => (s.rng() + s.rng() + s.rng() + s.rng() - 2) * 1.732;
const skillOf = (s, team) => (s.humanTeam == null || team === s.humanTeam ? 1 : SKILL[s.difficulty]);

/**
 * teams: two entries from data/teams.js. humanTeam: 0, 1, or null for computer vs computer.
 * halfSeconds: real seconds per half (the scoreboard clock is scaled to 30:00).
 */
export function createMatch({ teams, seed = 1, humanTeam = 0, difficulty = 1, halfSeconds = 240 }) {
  const s = {
    rng: makeRng(seed),
    time: 0,
    phase: 'throwoff', // throwoff | play | goal | halftime | fulltime
    phaseT: 0,
    half: 1,
    clock: 0,
    halfSeconds,
    humanTeam,
    difficulty,
    score: [0, 0],
    possTeam: 0, // team that has, or last had, the ball
    possT: 0,
    ctrl: null, // id of the player the human is steering
    autoSwitch: true,
    charge: 0, // shot power being wound up, 0..1
    power: false, // true while the wind-up is a power shot (Shift + Shoot)
    slow: 1, // game speed the loop should run at: below 1 is slow motion
    slowT: 0,
    nextThrow: 0,
    lastGoal: -1,
    events: [],
    stats: { shots: [0, 0], saves: [0, 0], steals: [0, 0], passes: [0, 0], blocks: [0, 0] },
    passTarget: null, // who the human's pass would go to right now (drawn as a marker)
    teams: teams.map((t, i) => ({ code: t.code, name: t.name, dir: i === 0 ? 1 : -1, gk: -1 })),
    players: [],
    ball: { x: 0, y: 1.2, z: 0, vx: 0, vy: 0, vz: 0, holder: null, kind: 'loose', by: -1, byTeam: 0, target: null, noCatchId: -1, noCatchT: 0, protectT: 0, idleT: 0, tried: 0 },
    ctx: { chaser: [-1, -1] },
  };
  teams.forEach((t, ti) => {
    for (const pl of t.players) {
      const id = s.players.length;
      s.players.push({
        id, team: ti, role: pl.pos, num: pl.num, name: pl.name ?? pl.pos,
        spd: pl.spd ?? 1, sht: pl.sht ?? 0.7,
        x: 0, z: 0, vx: 0, vz: 0, face: 0,
        hasBall: false, holdT: 0, minHold: 0.6, driveSide: 1, lastPasser: -1,
        steps: 0, dribbling: false, dribbled: false, // carrying rules, see core.js
        blocking: false, // arms up to block a shot (human defender holding Shoot)
        throwKind: 'pass', // what the last throw was: 'pass' | 'shot' | 'power' (for the animation)
        stun: 0, throwT: 0, jumpT: 0, aiT: 0, react: 0, cool: 0, stam: 1, sprinting: false,
      });
      if (pl.pos === 'GK') s.teams[ti].gk = id;
    }
  });
  setupThrowOff(s, 0);
  return s;
}

/** Scoreboard clock as "MM:SS", scaled so each half runs 30:00. */
export function clockText(s) {
  const t = Math.min(60 * 60, ((s.half - 1) + Math.min(1, s.clock / s.halfSeconds)) * 30 * 60);
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- possession

function giveBall(s, p, quiet) {
  const b = s.ball;
  if (b.holder != null) s.players[b.holder].hasBall = false;
  if (b.by >= 0 && s.players[b.by].team === p.team && b.by !== p.id) p.lastPasser = b.by;
  b.holder = p.id;
  b.kind = 'loose';
  b.target = null;
  b.idleT = 0;
  p.hasBall = true;
  p.holdT = 0;
  p.steps = 0;
  p.dribbling = false;
  p.dribbled = false;
  p.minHold = 0.35 + s.rng() * 0.8;
  p.driveSide = s.rng() < 0.5 ? -1 : 1;
  p.aiT = 0.15;
  if (p.team !== s.possTeam) {
    s.possTeam = p.team;
    s.possT = 0;
    s.autoSwitch = true;
  }
  carry(s);
  if (!quiet) emit(s, 'catch');
}

function release(s, p) {
  p.hasBall = false;
  s.ball.holder = null;
}

function carry(s) {
  const b = s.ball;
  const p = s.players[b.holder];
  b.x = p.x + Math.cos(p.face) * 0.35;
  b.z = p.z + Math.sin(p.face) * 0.35;
  b.y = 1.15;
  b.vx = p.vx;
  b.vz = p.vz;
  b.vy = 0;
}

function nearestCourt(s, team, x, z, exclude = -1) {
  let best = null;
  let bd = Infinity;
  for (const p of s.players) {
    if (p.team !== team || p.role === 'GK' || p.id === exclude) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function setupThrowOff(s, team) {
  for (const p of s.players) {
    const dir = s.teams[p.team].dir;
    let [u, w] = KICKOFF[p.role];
    if (p.team !== team && (p.role === 'CB' || p.role === 'PV')) u -= 3.5; // defenders give 3 m
    p.x = dir * (u - HALF_L);
    p.z = dir * w;
    p.vx = p.vz = 0;
    p.face = dir > 0 ? 0 : Math.PI;
    p.hasBall = false;
    p.stun = p.throwT = p.jumpT = p.react = 0;
    p.lastPasser = -1;
  }
  const b = s.ball;
  b.holder = null;
  b.by = -1;
  s.possTeam = team;
  s.possT = 0;
  giveBall(s, s.players.find((p) => p.team === team && p.role === 'CB'), true);
  b.protectT = 2.2;
  s.charge = 0;
  s.autoSwitch = true;
  s.phase = 'throwoff';
  s.phaseT = 1.4;
}

/** Free throw / throw-in: hand the ball to the nearest court player of `team` at a spot. */
function awardBall(s, team, x, z) {
  const p = nearestCourt(s, team, x, z);
  p.x = clamp(x, -HALF_L + 0.4, HALF_L - 0.4);
  p.z = clamp(z, -HALF_W + 0.2, HALF_W - 0.2);
  p.vx = p.vz = 0;
  p.stun = 0;
  keepOutOfAreas(p);
  for (const q of s.players) {
    if (q.team === team || q.role === 'GK') continue;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 3) {
      q.x = p.x + ((dx || 0.01) / (d || 0.01)) * 3;
      q.z = p.z + (dz / (d || 0.01)) * 3;
      keepOutOfAreas(q);
    }
  }
  giveBall(s, p, true);
  s.ball.protectT = 1.4;
  emit(s, 'whistle');
}

function keeperBall(s, team) {
  giveBall(s, s.players[s.teams[team].gk], true);
  s.ball.protectT = 2;
}

// ------------------------------------------------------------------- actions

function launch(b, tx, ty, tz, speed) {
  const dx = tx - b.x;
  const dz = tz - b.z;
  const dist = Math.hypot(dx, dz) || 0.01;
  const t = dist / speed;
  b.vx = (dx / dist) * speed;
  b.vz = (dz / dist) * speed;
  b.vy = (ty - b.y + 0.5 * GRAVITY * t * t) / t;
}

function doPass(s, p, m) {
  const b = s.ball;
  release(s, p);
  b.x = p.x;
  b.z = p.z;
  b.y = 1.55;
  const dist = Math.hypot(m.x - p.x, m.z - p.z);
  const speed = clamp(10 + dist * 0.6, 11, 20);
  const lead = (dist / speed) * 0.7; // throw to where the receiver is running
  const tx = m.x + m.vx * lead;
  const tz = m.z + m.vz * lead;
  launch(b, tx, 1.25, tz, speed);
  b.kind = 'pass';
  b.target = m.id;
  b.by = p.id;
  b.byTeam = p.team;
  b.noCatchId = p.id;
  b.noCatchT = 0.3;
  p.throwT = 0.28;
  p.throwKind = 'pass';
  s.stats.passes[p.team]++;
  p.face = Math.atan2(tz - p.z, tx - p.x);
  emit(s, 'pass');
}

function doShot(s, p, aimZ, aimY, power, errMul, big = false) {
  const b = s.ball;
  const gx = s.teams[p.team].dir * HALF_L;
  release(s, p);
  b.x = p.x;
  b.z = p.z;
  b.y = 2.0; // jump-shot release height
  // Scatter grows with distance and shrinks with the shooter's rating.
  // A power shot is thrown much harder and keeps its accuracy from long range.
  const d = goalDist(p.x, p.z, gx);
  const sigma = (big ? 0.14 + d * 0.022 : 0.12 + d * 0.028) * (1.25 - 0.5 * p.sht) * errMul;
  const tz = aimZ + gauss(s) * sigma;
  const ty = Math.max(0.15, aimY + gauss(s) * sigma * 0.6);
  launch(b, gx, ty, tz, big ? 28 + power * 5 : 19 + power * 9);
  b.kind = 'shot';
  b.big = big;
  b.tried = 0;
  b.target = null;
  b.by = p.id;
  b.byTeam = p.team;
  b.noCatchId = p.id;
  b.noCatchT = 0.3;
  p.throwT = big ? 0.5 : 0.35;
  p.throwKind = big ? 'power' : 'shot';
  p.jumpT = big ? 0.3 : 0.5; // a power shot is released at the top of the jump
  if (big) {
    p.stam = Math.max(0, p.stam - POWER_COST);
    p.stun = 0.45; // landing
  }
  p.face = Math.atan2(tz - p.z, gx - p.x);
  s.stats.shots[p.team]++;
  const keeper = s.players[s.teams[1 - p.team].gk];
  // The keeper sees the big wind-up coming, so he is quicker off the mark for a power shot.
  keeper.react = (KEEPER_REACT * (big ? 0.85 : 1)) / skillOf(s, keeper.team);
  emit(s, 'shot', { team: p.team, power: big });
}

function steal(s, thief, holder) {
  holder.hasBall = false;
  holder.stun = 0.45;
  s.ball.holder = null;
  s.ball.by = -1;
  giveBall(s, thief, true);
  s.ball.protectT = 0.6;
  s.stats.steals[thief.team]++;
  emit(s, 'steal', { team: thief.team });
}

/** FIFA-style pass targeting: the team-mate best lined up with the direction being pushed. */
function pickPassTarget(s, p, dx, dz) {
  let best = null;
  let bestScore = -Infinity;
  for (const m of s.players) {
    if (m.team !== p.team || m.id === p.id) continue;
    const vx = m.x - p.x;
    const vz = m.z - p.z;
    const d = Math.hypot(vx, vz) || 0.01;
    if (d > 30) continue;
    let score = (vx * dx + vz * dz) / d - d / 60;
    if (m.role === 'GK') score -= 0.6; // only pass back to the keeper when clearly aiming at him
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

function startDribble(p) {
  p.dribbling = true;
  p.dribbled = true;
}

function endDribble(p) {
  p.dribbling = false;
  p.steps = 0;
  p.holdT = 0;
}

// ------------------------------------------------------------------- control

function updateControl(s, input) {
  const H = s.humanTeam;
  if (H == null) {
    s.ctrl = null;
    return;
  }
  const b = s.ball;
  const holder = b.holder != null ? s.players[b.holder] : null;
  // In attack you are always the player with the ball, or the one about to receive it.
  if (holder && holder.team === H) {
    if (holder.role !== 'GK') s.ctrl = holder.id;
    return;
  }
  if (!holder && b.kind === 'pass' && b.byTeam === H && b.target != null) {
    if (s.players[b.target].role !== 'GK') s.ctrl = b.target;
    return;
  }
  // In defence: nearest player to the ball, re-picked on a turnover or when Switch is pressed.
  if (s.ctrl == null || s.autoSwitch) {
    s.ctrl = nearestCourt(s, H, b.x, b.z).id;
    s.autoSwitch = false;
  } else if (input.switchP) {
    const n = nearestCourt(s, H, b.x, b.z);
    s.ctrl = n.id !== s.ctrl ? n.id : nearestCourt(s, H, b.x, b.z, s.ctrl).id;
  }
}

function humanControl(s, p, input, dt) {
  const b = s.ball;
  let mx = input.mx;
  let mz = input.mz;
  const mag = Math.hypot(mx, mz);
  const active = mag > 0.15;
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }
  if (!active) {
    mx = mz = 0;
    // Hands off the keys while a pass is on its way: run onto it automatically.
    if (b.holder == null && b.kind === 'pass' && b.target === p.id) {
      const t = aiMove(s, p, s.ctx);
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d > 0.12) {
        mx = (t.x - p.x) / d;
        mz = (t.z - p.z) / d;
      }
    }
  }
  if (p.hasBall) {
    // Shift with the ball is the dribble: one per catch. Letting go picks the ball
    // up again, which gives three fresh steps and three fresh seconds.
    const want = input.sprint && active && !input.shootHeld;
    if (!p.dribbling && want && !p.dribbled) startDribble(p);
    else if (p.dribbling && !want) endDribble(p);
  }
  p.sprinting = input.sprint && active && p.stam > 0.02 && !p.hasBall;
  p.stam = p.sprinting ? Math.max(0, p.stam - 0.2 * dt) : Math.min(1, p.stam + 0.13 * dt);

  if (p.hasBall) {
    if (input.passP) {
      const m = pickPassTarget(s, p, active ? mx : Math.cos(p.face), active ? mz : Math.sin(p.face));
      if (m) doPass(s, p, m);
      s.charge = 0;
    } else if (input.shootHeld) {
      // Hold to wind up. Shift + Shoot together is the power shot: slow motion while
      // you aim, a much harder throw, at the cost of stamina.
      if (!s.power && s.charge < 0.2) s.power = input.sprint && p.stam >= POWER_COST;
      s.charge = Math.min(1, s.charge + dt / (s.power ? 0.45 : 0.8));
    } else if (s.charge > 0 && s.power) {
      const keeper = s.players[s.teams[1 - p.team].gk];
      const aimZ = active && Math.abs(mz) > 0.35 ? Math.sign(mz) * 1.18 : (keeper.z > 0 ? -1 : 1) * 0.8;
      let err = 1;
      for (const q of s.players) {
        if (q.team !== p.team && q.role !== 'GK' && Math.hypot(q.x - p.x, q.z - p.z) < 1.4) err = 1.5;
      }
      doShot(s, p, aimZ, 0.5 + s.charge * 1.2, Math.max(0.3, s.charge), err, true);
      s.slowT = 0.3; // stay in slow motion while the ball leaves the hand
      s.charge = 0;
    } else if (s.charge > 0) {
      // Released: shoot. Push towards a post to aim at it, otherwise aim away from the keeper.
      const keeper = s.players[s.teams[1 - p.team].gk];
      const aimZ = active && Math.abs(mz) > 0.35 ? Math.sign(mz) * 1.18 : (keeper.z > 0 ? -1 : 1) * 0.75;
      const power = Math.max(0.2, s.charge);
      let aimY = 0.35 + power * 1.45;
      let err = 1;
      if (power > 0.93) {
        aimY += 0.3; // over-hit: the ball sails
        err = 1.6;
      }
      for (const q of s.players) {
        if (q.team !== p.team && q.role !== 'GK' && Math.hypot(q.x - p.x, q.z - p.z) < 1.4) err = Math.max(err, 1.35);
      }
      doShot(s, p, aimZ, aimY, power, err);
      s.charge = 0;
    }
  } else {
    s.charge = 0;
    // Defending. Holding Shoot puts the arms up: a shot through you is far more
    // likely to be blocked, but you can only shuffle while you do it.
    p.blocking = input.shootHeld && s.possTeam !== p.team;
    // Pass is a steal attempt on a carrier within reach.
    if (input.passP && p.cool <= 0) {
      p.cool = 0.9;
      const holder = b.holder != null ? s.players[b.holder] : null;
      if (holder && holder.team !== p.team && holder.role !== 'GK' && b.protectT <= 0 && Math.hypot(holder.x - p.x, holder.z - p.z) < 1.25) {
        if (s.rng() < (holder.dribbling ? 0.5 : 0.18)) steal(s, p, holder);
        else p.stun = 0.35;
      }
    }
  }
  if (p.hasBall) {
    p.blocking = false;
    s.passTarget = pickPassTarget(s, p, active ? mx : Math.cos(p.face), active ? mz : Math.sin(p.face))?.id ?? null;
  }
  return { mx, mz, speed: (p.blocking ? RUN * 0.55 : p.dribbling ? DRIBBLE : p.sprinting ? SPRINT : RUN) * p.spd };
}

// ------------------------------------------------------------------ movement

function accelerate(p, tvx, tvz, accel, dt) {
  const dvx = tvx - p.vx;
  const dvz = tvz - p.vz;
  const k = Math.min(1, (accel * dt) / (Math.hypot(dvx, dvz) || 1e-6));
  p.vx += dvx * k;
  p.vz += dvz * k;
}

function turnToward(a, target, maxStep) {
  let d = target - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + clamp(d, -maxStep, maxStep);
}

function keepOutOfAreas(p) {
  for (const gx of [-HALF_L, HALF_L]) {
    const cz = clamp(p.z, -GOAL_HALF, GOAL_HALF);
    let nx = p.x - gx;
    let nz = p.z - cz;
    let d = Math.hypot(nx, nz);
    if (d >= AREA_R + 0.02) continue;
    if (d < 1e-6) {
      nx = -Math.sign(gx);
      nz = 0;
      d = 1;
    }
    p.x = gx + (nx / d) * (AREA_R + 0.02);
    p.z = cz + (nz / d) * (AREA_R + 0.02);
  }
}

function constrain(s) {
  // Players are solid: push overlapping pairs apart.
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const dx = ps[j].x - ps[i].x;
      const dz = ps[j].z - ps[i].z;
      const d = Math.hypot(dx, dz);
      if (d >= 0.62 || d < 1e-5) continue;
      const push = (0.62 - d) / 2 / d;
      ps[i].x -= dx * push;
      ps[i].z -= dz * push;
      ps[j].x += dx * push;
      ps[j].z += dz * push;
    }
  }
  for (const p of ps) {
    if (p.role === 'GK') {
      // The keeper stays inside his own goal area.
      const dir = s.teams[p.team].dir;
      const gx = -dir * HALF_L;
      const cz = clamp(p.z, -GOAL_HALF, GOAL_HALF);
      const d = Math.hypot(p.x - gx, p.z - cz);
      if (d > AREA_R - 0.4) {
        p.x = gx + ((p.x - gx) / d) * (AREA_R - 0.4);
        p.z = cz + ((p.z - cz) / d) * (AREA_R - 0.4);
      }
      if ((p.x - gx) * dir < 0.25) p.x = gx + dir * 0.25;
    } else {
      p.x = clamp(p.x, -HALF_L - 0.3, HALF_L + 0.3);
      p.z = clamp(p.z, -HALF_W - 0.6, HALF_W + 0.6);
      keepOutOfAreas(p);
    }
  }
}

function aiSteals(s, dt) {
  const b = s.ball;
  if (b.holder == null || b.protectT > 0) return;
  const holder = s.players[b.holder];
  if (holder.role === 'GK') return;
  for (const q of s.players) {
    if (q.team === holder.team || q.role === 'GK' || q.stun > 0) continue;
    if (q.id === s.ctrl && q.team === s.humanTeam) continue; // humans steal with a button press
    if (Math.hypot(q.x - holder.x, q.z - holder.z) > 0.95) continue;
    // A bouncing ball is much easier to take than one held in the hand.
    const rate = (q.team === s.humanTeam ? 0.1 : 0.14 * skillOf(s, q.team)) * (holder.dribbling ? 2.4 : 1);
    if (s.rng() < rate * dt) {
      steal(s, q, holder);
      return;
    }
  }
}

// ---------------------------------------------------------------------- ball

function goal(s, team) {
  const b = s.ball;
  s.score[team]++;
  s.lastGoal = team;
  s.nextThrow = 1 - team;
  s.phase = 'goal';
  s.phaseT = 2.6;
  s.charge = 0;
  b.vx *= 0.12;
  b.vz *= 0.12;
  b.vy *= 0.3;
  emit(s, 'goal', { team, scorer: b.byTeam === team ? b.by : -1 });
  b.kind = 'loose';
}

function updateBall(s, dt) {
  const b = s.ball;
  if (b.holder != null) {
    carry(s);
    return;
  }
  const px = b.x;
  const py = b.y;
  const pz = b.z;
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  if (b.y <= BALL_R) {
    b.y = BALL_R;
    if (b.vy < -1.2) {
      // A real bounce. Bounce shots stay live; a pass that hits the floor is anyone's ball.
      b.vy = -b.vy * 0.6;
      b.vx *= 0.85;
      b.vz *= 0.85;
      if (b.kind === 'pass') {
        b.kind = 'loose';
        b.target = null;
      }
      emit(s, 'bounce');
    } else {
      b.vy = 0;
      const f = Math.max(0, 1 - 1.5 * dt);
      b.vx *= f;
      b.vz *= f;
      if (b.kind !== 'loose' && Math.hypot(b.vx, b.vz) < 4) {
        b.kind = 'loose';
        b.target = null;
      }
    }
  }

  // Crossing a goal line: goal, woodwork, or out.
  for (const e of [-1, 1]) {
    if (px * e > HALF_L || b.x * e <= HALF_L) continue;
    const t = (HALF_L - px * e) / ((b.x - px) * e);
    const zc = pz + (b.z - pz) * t;
    const yc = py + (b.y - py) * t;
    const attackers = s.teams[0].dir === e ? 0 : 1;
    if (Math.abs(zc) < GOAL_HALF - 0.05 && yc < GOAL_H - 0.05) {
      goal(s, attackers);
    } else if (Math.abs(zc) < GOAL_HALF + 0.12 && yc < GOAL_H + 0.12) {
      b.x = e * (HALF_L - 0.02);
      b.vx = -b.vx * 0.55;
      b.kind = 'loose';
      b.target = null;
      emit(s, 'post');
    } else {
      emit(s, 'out');
      keeperBall(s, 1 - attackers);
    }
    return;
  }
  if (Math.abs(b.z) > HALF_W + 0.15) {
    emit(s, 'out');
    awardBall(s, 1 - b.byTeam, b.x, Math.sign(b.z) * HALF_W);
    return;
  }

  // Players touching the ball.
  for (const p of s.players) {
    if ((p.id === b.noCatchId && b.noCatchT > 0) || p.stun > 0) continue;
    const d = Math.hypot(p.x - b.x, p.z - b.z);
    if (b.kind === 'shot') {
      if (p.team === b.byTeam) continue;
      if (p.role === 'GK') {
        const reach = KEEPER_REACH * (b.y > 1.5 ? 0.8 : 1); // top corners are harder to cover
        if (Math.abs(b.x - p.x) < 0.5 && Math.abs(b.z - p.z) < reach && b.y < 2.2) {
          s.stats.saves[p.team]++;
          emit(s, 'save', { team: p.team });
          if (s.rng() < 0.6) {
            giveBall(s, p, true);
            b.protectT = 2;
          } else {
            // Parried back into play.
            b.vx = -b.vx * 0.3;
            b.vz = (s.rng() - 0.5) * 10;
            b.vy = 2 + s.rng() * 3;
            b.kind = 'loose';
            b.byTeam = p.team;
            b.noCatchId = p.id;
            b.noCatchT = 0.3;
            s.autoSwitch = true;
          }
          return;
        }
      } else if (d < (p.blocking ? 0.8 : 0.45) && b.y < (p.blocking ? 2.7 : 2.15) && !(b.tried & (1 << p.id))) {
        // A defender in the shooting lane gets one go at the block. Arms up
        // (a human holding Shoot) covers more space and nearly always gets a hand to it.
        b.tried |= 1 << p.id;
        if (s.rng() > (p.blocking ? 0.9 : BLOCK_CHANCE) * (b.big ? 0.6 : 1)) continue;
        s.stats.blocks[p.team]++;
        b.vx = -b.vx * 0.25 + (s.rng() - 0.5) * 4;
        b.vz = b.vz * 0.25 + (s.rng() - 0.5) * 6;
        b.vy = 1.5 + s.rng() * 3;
        b.kind = 'loose';
        b.byTeam = p.team;
        b.noCatchId = p.id;
        b.noCatchT = 0.25;
        s.autoSwitch = true;
        emit(s, 'block');
        return;
      }
    } else if (b.kind === 'pass') {
      const mate = p.team === b.byTeam;
      if (b.y < 2.4 && d < (mate ? (p.id === b.target ? 1.0 : 0.7) : 0.55)) {
        giveBall(s, p);
        return;
      }
    } else if (d < 0.8 && b.y < 1.4) {
      giveBall(s, p);
      return;
    }
  }

  // A ball nobody can reach must not stall the match.
  if (Math.hypot(b.vx, b.vz) < 0.4 && b.y < 0.3) {
    b.idleT += dt;
    if (b.idleT > 2.5) {
      b.idleT = 0;
      const end = b.x > 0 ? 1 : -1;
      if (goalDist(b.x, b.z, end * HALF_L) < AREA_R) keeperBall(s, s.teams[0].dir === end ? 1 : 0);
      else awardBall(s, 1 - b.byTeam, b.x, b.z);
    }
  } else {
    b.idleT = 0;
  }
}

/** Between plays (after a goal, before a throw-off): players stop, the ball settles in the net. */
function settle(s, dt) {
  const b = s.ball;
  for (const p of s.players) {
    accelerate(p, 0, 0, ACCEL, dt);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.throwT = Math.max(0, p.throwT - dt);
    p.jumpT = Math.max(0, p.jumpT - dt);
  }
  constrain(s);
  if (b.holder != null) {
    carry(s);
    return;
  }
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.y <= BALL_R) {
    b.y = BALL_R;
    b.vy = b.vy < -1.2 ? -b.vy * 0.4 : 0;
    const f = Math.max(0, 1 - 4 * dt);
    b.vx *= f;
    b.vz *= f;
  }
  if (Math.abs(b.x) > HALF_L + 0.9) {
    b.x = Math.sign(b.x) * (HALF_L + 0.9); // back of the net
    b.vx = 0;
  }
  if (Math.abs(b.z) > HALF_W + 2) {
    b.z = Math.sign(b.z) * (HALF_W + 2); // the boards round the court
    b.vz = 0;
  }
}

// ---------------------------------------------------------------------- step

export function step(s, dt, input = NO_INPUT) {
  s.time += dt;
  s.slowT = Math.max(0, s.slowT - dt);
  if (s.charge === 0) s.power = false;
  s.slow = s.phase === 'play' && s.power ? 0.3 : s.slowT > 0 ? 0.45 : 1;
  if (s.phase === 'fulltime') return;

  if (s.phase !== 'play') {
    s.phaseT -= dt;
    settle(s, dt);
    if (s.phaseT > 0) return;
    if (s.phase === 'goal') {
      setupThrowOff(s, s.nextThrow);
    } else if (s.phase === 'halftime') {
      s.half = 2;
      s.clock = 0;
      for (const t of s.teams) t.dir = -t.dir; // change ends
      setupThrowOff(s, 1);
    } else {
      s.phase = 'play';
      emit(s, 'whistle');
    }
    return;
  }

  s.clock += dt;
  if (s.clock >= s.halfSeconds) {
    if (s.half === 1) {
      s.phase = 'halftime';
      s.phaseT = 3;
      emit(s, 'halftime');
    } else {
      s.phase = 'fulltime';
      emit(s, 'fulltime');
    }
    return;
  }

  const b = s.ball;
  s.passTarget = null;
  teamContext(s);
  updateControl(s, input);
  b.noCatchT = Math.max(0, b.noCatchT - dt);
  b.protectT = Math.max(0, b.protectT - dt);
  if (b.holder != null) s.possT += dt;

  for (const p of s.players) {
    p.throwT = Math.max(0, p.throwT - dt);
    p.jumpT = Math.max(0, p.jumpT - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.react = Math.max(0, p.react - dt);
    p.cool = Math.max(0, p.cool - dt);
    if (p.hasBall && !p.dribbling) p.holdT += dt;
    if (p.id !== s.ctrl) p.blocking = false;

    let mx = 0;
    let mz = 0;
    let speed = 0;
    let accel = ACCEL;
    if (p.stun > 0) {
      // caught off balance: stand still
    } else if (p.id === s.ctrl && p.team === s.humanTeam) {
      ({ mx, mz, speed } = humanControl(s, p, input, dt));
    } else {
      const t = aiMove(s, p, s.ctx);
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.12) {
        mx = dx / d;
        mz = dz / d;
        if (p.role === 'GK') {
          speed = Math.min(KEEPER_SPEED * skillOf(s, p.team), d * 8 + 0.3);
          accel = 60;
        } else {
          speed = Math.min((t.sprint ? AI_FAST : RUN) * p.spd, d * 5 + 0.4);
        }
      }
      if (p.hasBall) {
        p.aiT -= dt;
        if (p.aiT <= 0) {
          p.aiT = 0.12;
          const act = aiCarrier(s, p);
          if (act?.type === 'pass') doPass(s, p, s.players[act.target]);
          else if (act?.type === 'shoot') doShot(s, p, act.aimZ, act.aimY, act.power, 1 / skillOf(s, p.team), !!act.big);
          else if (act?.type === 'dribble') startDribble(p);
          else if (act?.type === 'pickup') endDribble(p);
        }
        if (p.dribbling) speed = Math.min(speed, DRIBBLE * p.spd);
      }
    }
    if (p.hasBall && p.role !== 'GK' && !p.dribbling) {
      // Three steps with the ball in hand, then your feet are planted.
      speed = p.steps >= MAX_STEPS * STEP_LEN ? 0 : Math.min(speed, RUN * p.spd);
    }
    accelerate(p, mx * speed, mz * speed, accel, dt);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    if (p.hasBall && !p.dribbling) p.steps += Math.hypot(p.vx, p.vz) * dt;

    // Face the way you run; standing still, attackers face goal and defenders watch the ball.
    let want = p.face;
    if (p.throwT > 0) want = p.face;
    else if (Math.hypot(p.vx, p.vz) > 0.6 && p.role !== 'GK') want = Math.atan2(p.vz, p.vx);
    else if (p.role === 'GK' || s.possTeam !== p.team) want = Math.atan2(b.z - p.z, b.x - p.x);
    else want = Math.atan2(-p.z * 0.2, s.teams[p.team].dir * HALF_L - p.x);
    p.face = turnToward(p.face, want, 12 * dt);
  }

  constrain(s);
  aiSteals(s, dt);
  updateBall(s, dt);

  // Free throw to the other team for holding the ball more than three seconds,
  // or for passive play (a whole attack without a shot).
  if (s.phase === 'play' && b.holder != null) {
    const h = s.players[b.holder];
    const held = !h.dribbling && h.holdT > HOLD_LIMIT;
    if (h.role !== 'GK' && (held || s.possT > PASSIVE_LIMIT)) {
      emit(s, held ? 'held' : 'passive', { team: h.team });
      h.hasBall = false;
      b.holder = null;
      b.by = -1;
      awardBall(s, 1 - h.team, h.x, h.z);
    }
  }
}
