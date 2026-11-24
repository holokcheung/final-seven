// Shared constants and maths for the match simulation.
// The simulation never touches the DOM or Three.js, so it can run in Node for tests.
//
// Court coordinates (metres): x runs goal to goal (-20..20), z runs sideline to
// sideline (-10..10), y is height. Goals sit on x = -20 and x = +20.

export const HALF_L = 20;
export const HALF_W = 10;
export const GOAL_HALF = 1.5; // the goal is 3 m wide
export const GOAL_H = 2;
export const AREA_R = 6; // goal area: only the goalkeeper may stand inside
export const FREE_R = 9; // dashed free-throw line
export const GRAVITY = 9.81;
export const BALL_R = 0.12;
export const STEP = 1 / 120; // fixed simulation step, in seconds

// Carrying rules: with the ball in hand you get three steps and three seconds.
// One dribble per catch resets both, exactly as in the real game.
export const MAX_STEPS = 3;
export const STEP_LEN = 1.15; // metres covered by one step
export const HOLD_LIMIT = 3; // seconds

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Small seeded random generator, so a match can be replayed from its seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from a point to the goal mouth on the line x = gx. Under 6 means inside the goal area. */
export function goalDist(x, z, gx) {
  return Math.hypot(x - gx, z - clamp(z, -GOAL_HALF, GOAL_HALF));
}

/** How wide the goal mouth looks (in radians) from a point: small from the wings, large from the middle. */
export function goalView(x, z, gx) {
  const a = Math.abs(Math.atan2(GOAL_HALF - z, gx - x) - Math.atan2(-GOAL_HALF - z, gx - x));
  return a > Math.PI ? 2 * Math.PI - a : a;
}

/** Distance from point p to the segment a-b. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1e-9), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
