// Team AI: where every player wants to stand, and what a computer-controlled
// ball carrier does. Positions are written in each team's own "attack frame":
// u = metres from its own goal line (0) to the opponent's (40), w = metres across.

import { HALF_L, GOAL_HALF, AREA_R, MAX_STEPS, STEP_LEN, HOLD_LIMIT, clamp, goalDist, goalView, segDist } from './core.js';

// 3-3 attack: two wings, three backs around the 9 m line, a pivot on the 6 m line.
const ATTACK = { LW: [36.4, -8.7], LB: [29.6, -5.8], CB: [28.4, 0], RB: [29.6, 5.8], RW: [36.4, 8.7], PV: [33.2, 0.6] };
// 6-0 defence: six players in a wall just outside their own goal area.
const DEFEND_W = { LW: -7.3, LB: -4.4, PV: -1.5, CB: 1.5, RB: 4.4, RW: 7.3 };
// Throw-off: everyone in their own half.
export const KICKOFF = { GK: [1.2, 0], LW: [16.5, -8], LB: [13.5, -4.5], CB: [19.7, 0], RB: [13.5, 4.5], RW: [16.5, 8], PV: [17.5, 2.6] };

const toWorld = (dir, u, w, sprint) => ({ x: dir * (u - HALF_L), z: dir * w, sprint });

/** Picks, for each team, the court player who goes to the ball (with some stickiness so it doesn't flicker). */
export function teamContext(s) {
  const b = s.ball;
  const chaser = s.ctx.chaser;
  for (let t = 0; t < 2; t++) {
    const prev = chaser[t];
    let best = Infinity;
    for (const p of s.players) {
      if (p.team !== t || p.role === 'GK' || p.stun > 0) continue;
      let d = Math.hypot(p.x - b.x, p.z - b.z);
      if (p.id === prev) d -= 0.8;
      if (d < best) {
        best = d;
        chaser[t] = p.id;
      }
    }
  }
  return s.ctx;
}

function keeperMove(s, p) {
  const dir = s.teams[p.team].dir;
  const gx = -dir * HALF_L;
  const b = s.ball;
  if (p.hasBall) return { x: p.x, z: p.z };
  if (b.holder == null) {
    // A loose ball inside the goal area belongs to the keeper.
    if (b.kind === 'loose' && Math.abs(b.x) < HALF_L && goalDist(b.x, b.z, gx) < AREA_R - 0.1) {
      return { x: b.x, z: b.z, sprint: true };
    }
    // A shot is coming: after the reaction time, slide across to where it will arrive.
    if (b.kind === 'shot' && b.byTeam !== p.team) {
      if (p.react > 0) return { x: p.x, z: p.z };
      const t = (p.x - b.x) / (b.vx || 1e-6);
      return { x: p.x, z: t > 0 ? clamp(b.z + b.vz * t, -1.7, 1.7) : p.z, sprint: true };
    }
  }
  // Otherwise stand on the line between the ball and the middle of the goal.
  const dx = b.x - gx;
  const l = Math.hypot(dx, b.z) || 1;
  return { x: gx + dir * clamp((Math.abs(dx) / l) * 1.2, 0.5, 1.2), z: clamp((b.z / l) * 1.3, -1.15, 1.15) };
}

/** Where a computer-controlled carrier runs: towards a spot about 7.5 m out, probing a gap. */
function driveTarget(s, p) {
  const dir = s.teams[p.team].dir;
  const gx = dir * HALF_L;
  if (p.role === 'LW' || p.role === 'RW') return toWorld(dir, 36, p.role === 'LW' ? -6.3 : 6.3, true);
  const ang = Math.atan2(p.z, p.x - gx) + p.driveSide * 0.22;
  return { x: clamp(gx + Math.cos(ang) * 7.6, -19.4, 19.4), z: clamp(Math.sin(ang) * 7.6, -9.5, 9.5), sprint: true };
}

/** Target position for any player who is not being steered by a human. */
export function aiMove(s, p, ctx) {
  if (p.role === 'GK') return keeperMove(s, p);
  const dir = s.teams[p.team].dir;
  const b = s.ball;
  const holder = b.holder != null ? s.players[b.holder] : null;

  if (!holder) {
    if (b.kind === 'pass' && b.target === p.id) return { x: b.x + b.vx * 0.12, z: b.z + b.vz * 0.12, sprint: true };
    if (b.kind === 'loose' && ctx.chaser[p.team] === p.id) return { x: b.x + b.vx * 0.2, z: b.z + b.vz * 0.2, sprint: true };
  }

  if (s.possTeam === p.team) {
    if (holder === p) return driveTarget(s, p);
    // Hold the attacking shape, drifting a little so defenders have something to track.
    // The backs keep cutting in towards goal and dropping off again, so the carrier always has a pass on.
    const [u0, w0] = ATTACK[p.role];
    const ph = s.time * 0.8 + p.id * 1.7;
    const back = p.role === 'LB' || p.role === 'CB' || p.role === 'RB';
    let u = u0 + (back ? 1.2 + Math.sin(ph * 1.1) * 1.8 : Math.cos(ph * 0.7) * 0.7);
    let w = w0 + Math.sin(ph) * 0.9;
    if (p.role === 'PV') w = clamp(dir * b.z * 0.35, -2.2, 2.2) + Math.sin(ph) * 0.8;
    const t = toWorld(dir, u, w, false);
    t.sprint = Math.hypot(t.x - p.x, t.z - p.z) > 4;
    return t;
  }

  // Defending. The player nearest the carrier steps out and stays between the carrier and the goal.
  const ownGx = -dir * HALF_L;
  if (holder && holder.role !== 'GK' && ctx.chaser[p.team] === p.id && goalDist(holder.x, holder.z, ownGx) < 14) {
    const nx = ownGx - holder.x;
    const nz = clamp(holder.z, -GOAL_HALF, GOAL_HALF) * 0.5 - holder.z;
    const l = Math.hypot(nx, nz) || 1;
    return { x: holder.x + nx / l, z: holder.z + nz / l, sprint: true };
  }
  // Everyone else holds the wall, sliding towards the side the ball is on.
  const w = DEFEND_W[p.role] + clamp(dir * b.z, -10, 10) * 0.14;
  const side = Math.max(0, Math.abs(w) - GOAL_HALF);
  const t = toWorld(dir, Math.sqrt(Math.max(0.5, 6.9 * 6.9 - side * side)), w, false);
  t.sprint = Math.hypot(t.x - p.x, t.z - p.z) > 4;
  return t;
}

const CHAIN = ['LW', 'LB', 'CB', 'RB', 'RW']; // the ball usually travels along this line

function bestPass(s, p, gx, minLane = 0.85) {
  const own = goalDist(p.x, p.z, gx);
  const at = CHAIN.indexOf(p.role);
  let best = null;
  let bestScore = 0.15;
  for (const m of s.players) {
    if (m.team !== p.team || m.id === p.id || m.role === 'GK') continue;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d < 2.2 || d > 22) continue;
    let lane = 9;
    let open = 9;
    for (const q of s.players) {
      if (q.team === p.team || q.role === 'GK') continue;
      lane = Math.min(lane, segDist(q.x, q.z, p.x, p.z, m.x, m.z));
      open = Math.min(open, Math.hypot(q.x - m.x, q.z - m.z));
    }
    if (lane < minLane) continue; // a defender is standing in the passing lane
    let score = Math.min(lane, 3) * 0.3 + Math.min(open, 3) * 0.35;
    score += (13 - Math.min(13, goalDist(m.x, m.z, gx))) * 0.1 + goalView(m.x, m.z, gx) * 1.2;
    score += clamp(own - goalDist(m.x, m.z, gx), -6, 12) * 0.07; // moves the ball up the court
    const to = CHAIN.indexOf(m.role);
    if (at >= 0 && to >= 0 && Math.abs(at - to) === 1) score += 0.5; // next man along
    if (d > 14) score -= (d - 14) * 0.2;
    if (m.id === p.lastPasser) score -= 0.7; // don't just hand it straight back
    score += s.rng() * 0.7;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/**
 * Decision for a computer-controlled ball carrier.
 * Returns { type: 'shoot', aimZ, aimY, power }, { type: 'pass', target },
 * { type: 'dribble' }, { type: 'pickup' } or null (keep the ball).
 */
export function aiCarrier(s, p) {
  const dir = s.teams[p.team].dir;
  const gx = dir * HALF_L;
  const rng = s.rng;

  if (p.role === 'GK') {
    if (p.holdT < 0.9) return null;
    let m = bestPass(s, p, gx);
    if (!m && p.holdT > 2.5) m = s.players.find((q) => q.team === p.team && q.role === 'CB');
    return m ? { type: 'pass', target: m.id } : null;
  }

  const d = goalDist(p.x, p.z, gx);
  const view = goalView(p.x, p.z, gx);
  const keeper = s.players[s.teams[1 - p.team].gk];
  let near = 99;
  for (const q of s.players) {
    if (q.team !== p.team && q.role !== 'GK') near = Math.min(near, Math.hypot(q.x - p.x, q.z - p.z));
  }

  // Look at both posts, the one further from the keeper first, and take the first clear lane.
  const far = keeper.z > 0 ? -1 : 1;
  let aimZ = null;
  for (const side of [far, -far]) {
    const z = side * (0.85 + rng() * 0.4);
    let blocked = false;
    for (const q of s.players) {
      if (q.team === p.team || q.role === 'GK') continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 4 && segDist(q.x, q.z, p.x, p.z, gx, z) < 0.7) blocked = true;
    }
    if (!blocked) {
      aimZ = z;
      break;
    }
  }

  const shot = (z) => ({ type: 'shoot', aimZ: z, aimY: 0.25 + rng() * 1.5, power: 0.55 + rng() * 0.45 });
  // Early in an attack the team works the ball round; it only shoots at once from a really good spot.
  const patient = s.possT < 5 && !(d < 8 && view > 0.3);
  if (aimZ != null && d < 9.8 && view > 0.2 && rng() < (patient ? 0.06 : 0.4)) return shot(aimZ);
  // A clear look from long range: wind up a power shot.
  if (aimZ != null && !patient && d >= 9.8 && d < 13 && view > 0.2 && near > 1.8 && rng() < 0.06) return { ...shot(aimZ), power: 1, big: true };
  // Running out of time in this attack: take what is on offer.
  if (s.possT > 14 && d < 12 && view > 0.16 && rng() < 0.3) return shot(aimZ ?? far);

  // Pass-and-move is the default: three steps go quickly.
  const planted = !p.dribbling && p.steps >= MAX_STEPS * STEP_LEN - 0.1;
  if ((p.dribbling || p.holdT > p.minHold) && (near < 2 || planted || d > 12.5 || p.holdT > p.minHold + 0.8)) {
    const m = bestPass(s, p, gx);
    if (m) return { type: 'pass', target: m.id };
  }

  // The one dribble is for open court only: nobody to pass to, nobody near.
  if (p.dribbling) {
    if (d < 11.5 || near < 2.4) return { type: 'pickup' };
  } else if (!p.dribbled && d > 13 && near > 3 && p.steps > 1.5) {
    return { type: 'dribble' };
  }

  // Three seconds nearly up: shoot if it is on, otherwise move it to anyone.
  if (!p.dribbling && p.holdT > HOLD_LIMIT - 1) {
    if (d < 11 && view > 0.16) return shot(aimZ ?? far);
    let m = bestPass(s, p, gx, 0.4);
    if (!m) {
      let bd = Infinity;
      for (const q of s.players) {
        const dq = Math.hypot(q.x - p.x, q.z - p.z);
        if (q.team === p.team && q.id !== p.id && q.role !== 'GK' && dq < bd) {
          bd = dq;
          m = q;
        }
      }
    }
    return { type: 'pass', target: m.id };
  }
  return null;
}
