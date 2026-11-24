// A jointed player figure and its animation.
//
// There are no animation files. Each frame a target pose (a set of joint angles)
// is worked out from what the player is doing in the match - running, defending,
// winding up, throwing, jumping, blocking, saving - and the figure eases towards
// it, so one movement flows into the next instead of snapping.
//
// The figure faces +x. Its right side is +z.

import * as THREE from 'three';
import { clamp } from '../sim/core.js';
import { makeNumberTexture } from './textures.js';

const BODY = 0xd9dde4; // plain mannequin: a shirt and a number, no likeness
const THIGH = 0.46;
const SHIN = 0.44;
const FOOT = 0.07;
const UPPER = 0.3;
const FORE = 0.27;
const JOINTS = ['lean', 'twist', 'bend', 'head', 'lSh', 'lOut', 'lEl', 'rSh', 'rOut', 'rEl', 'lHip', 'lKnee', 'lSplay', 'rHip', 'rKnee', 'rSplay', 'rise'];
const BLEND = 16; // how quickly the figure eases into a new pose (higher = snappier)

const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 });

/** A rounded limb segment hanging down from its parent joint. */
function segment(length, radius, mat, parent) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - 2 * radius), 3, 8), mat);
  m.position.y = -length / 2;
  m.castShadow = true;
  parent.add(m);
  return m;
}

function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function buildFigure(team, pl) {
  const keeper = pl.pos === 'GK';
  const shirt = material(keeper ? team.keeper : team.shirt);
  const shorts = material(keeper ? team.keeper : team.shorts);
  const body = material(BODY);
  const shoe = material(0x1b1e26);

  const root = new THREE.Group();
  const turn = joint(root, 0, 0, 0); // faces the player the right way
  const hips = joint(turn, 0, 1, 0);
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.1, 3, 10), shorts);
  pelvis.scale.set(0.95, 1, 1.25);
  pelvis.castShadow = true;
  hips.add(pelvis);

  const spine = joint(hips, 0, 0.08, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 12), shirt);
  torso.position.y = 0.3;
  torso.scale.set(0.82, 1, 1.32);
  torso.castShadow = true;
  spine.add(torso);
  const number = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: makeNumberTexture(pl.num, '#ffffff'), transparent: true, depthWrite: false }),
  );
  number.position.set(-0.145, 0.36, 0);
  number.rotation.y = -Math.PI / 2; // on the back
  spine.add(number);

  const head = joint(spine, 0, 0.7, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), body);
  skull.position.y = 0.09;
  skull.castShadow = true;
  head.add(skull);

  const arm = (side) => {
    const shoulder = joint(spine, 0, 0.52, side * 0.255);
    segment(UPPER, 0.056, shirt, shoulder); // sleeve
    const elbow = joint(shoulder, 0, -UPPER, 0);
    segment(FORE, 0.047, body, elbow);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), body);
    hand.position.y = -FORE - 0.03;
    elbow.add(hand);
    const grip = joint(elbow, 0.04, -FORE - 0.15, 0); // where a held ball sits
    return { shoulder, elbow, grip };
  };
  const leg = (side) => {
    const hip = joint(hips, 0, 0, side * 0.105);
    segment(THIGH, 0.078, body, hip);
    segment(0.24, 0.092, shorts, hip); // leg of the shorts
    const knee = joint(hip, 0, -THIGH, 0);
    segment(SHIN, 0.06, body, knee);
    const ankle = joint(knee, 0, -SHIN, 0);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.25, FOOT, 0.1), shoe);
    foot.position.set(0.07, -FOOT / 2, 0);
    foot.castShadow = true;
    ankle.add(foot);
    return { hip, knee, ankle };
  };
  const L = { arm: arm(-1), leg: leg(-1) };
  const R = { arm: arm(1), leg: leg(1) };

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeNumberTexture(pl.num, '#ffffff'), depthWrite: false }));
  label.scale.set(0.5, 0.5, 1);
  label.position.y = 2.25;
  root.add(label);

  const zero = () => Object.fromEntries(JOINTS.map((k) => [k, 0]));
  return { root, turn, hips, spine, head, L, R, keeper, now: zero(), want: zero(), stride: pl.num, fresh: true };
}

/** Works out the pose this player should be in right now, into f.want. */
function choosePose(f, p, state, dt) {
  const q = f.want;
  const b = state.ball;
  const t = state.time;
  const speed = Math.hypot(p.vx, p.vz);
  const run = Math.min(1, speed / 5.5);
  f.stride += speed * dt * 2.9; // one full stride about every 2.2 m
  const s = Math.sin(f.stride);
  const c = Math.cos(f.stride);
  const defending = state.possTeam !== p.team;
  const crouch = defending ? 1 : 0.45; // defenders sit lower

  // Ready stance, blending into a run as speed builds.
  q.lean = 0.1 + 0.14 * crouch + 0.2 * run;
  q.twist = -s * 0.18 * run;
  q.bend = 0;
  q.rise = 0;
  const swing = (defending ? 0.5 : 0.8) * run; // defenders shuffle with short steps
  const hip = (0.12 + 0.22 * crouch) * (1 - run * 0.6);
  const knee = (0.25 + 0.45 * crouch) * (1 - run * 0.5);
  q.lHip = hip + s * swing;
  q.rHip = hip - s * swing;
  q.lKnee = knee + run * 0.95 * Math.max(0, c); // the knee folds as the leg comes through
  q.rKnee = knee + run * 0.95 * Math.max(0, -c);
  q.lSplay = q.rSplay = 0.06 + 0.14 * crouch * (1 - run);
  q.lSh = 0.15 - s * 0.7 * run;
  q.rSh = 0.15 + s * 0.7 * run;
  q.lEl = q.rEl = 0.45 + 0.9 * run;
  q.lOut = q.rOut = 0.1;

  // Eyes on the ball.
  let look = Math.atan2(b.z - p.z, b.x - p.x) - p.face;
  while (look > Math.PI) look -= 2 * Math.PI;
  while (look < -Math.PI) look += 2 * Math.PI;
  q.head = -clamp(look, -1.1, 1.1);

  const shotAtUs = b.holder == null && b.kind === 'shot' && b.byTeam !== p.team;
  const charging = p.id === state.ctrl && state.charge > 0;

  if (f.keeper) {
    // Keeper: wide and big.
    q.lean = 0.12;
    q.lSplay = q.rSplay = 0.32;
    q.lHip = q.rHip = 0.25 + s * swing * 0.4;
    q.lKnee = q.rKnee = 0.5;
    q.lOut = q.rOut = 1.15;
    q.lSh = q.rSh = 0.35;
    q.lEl = q.rEl = 0.6;
    if (shotAtUs) {
      // Throw a leg and both arms towards the side the shot is going.
      const side = clamp(((b.x - p.x) * -Math.sin(p.face) + (b.z - p.z) * Math.cos(p.face)) * 1.3, -1, 1);
      q.bend = 0.5 * side;
      q.lOut = q.rOut = 1.5;
      q.lSh = q.rSh = 0.7;
      q.lEl = q.rEl = 0.2;
      q.rise = 0.1 * Math.abs(side);
      if (side > 0) {
        q.rSplay = 0.95;
        q.rKnee = 0.1;
        q.rHip = 0.1;
      } else {
        q.lSplay = 0.95;
        q.lKnee = 0.1;
        q.lHip = 0.1;
      }
    }
  } else if (defending && !p.hasBall) {
    // Defender: hands up and out, more so when standing his ground.
    const set = 1 - run * 0.5;
    q.lOut = q.rOut = 0.1 + 0.7 * set;
    q.lSh = q.lSh * (1 - set) + 0.55 * set;
    q.rSh = q.rSh * (1 - set) + 0.55 * set;
    q.lEl = q.rEl = 1.1;
  }

  // Arms straight up to block: on command, or by reflex when a shot comes close.
  if (p.blocking || (shotAtUs && !f.keeper && Math.hypot(b.x - p.x, b.z - p.z) < 2.6)) {
    q.lSh = q.rSh = 3.0;
    q.lOut = q.rOut = 0.22;
    q.lEl = q.rEl = 0.08;
    q.lean = 0.03;
    q.rise = 0.16;
  }

  // The team-mate your pass would go to puts an arm up for it.
  if (state.passTarget === p.id) {
    q.lSh = 2.75;
    q.lOut = 0.3;
    q.lEl = 0.15;
  }

  if (p.hasBall) {
    if (p.dribbling) {
      q.rSh = 0.35;
      q.rOut = 0.25;
      q.rEl = 0.7 + 0.5 * Math.abs(Math.sin(t * 9)); // pumping the ball down
    } else {
      // Ball carried at the shoulder, ready to throw.
      q.rSh = 0.55;
      q.rOut = 0.15;
      q.rEl = 1.75;
      q.lSh = Math.max(q.lSh, 0.3);
    }
    if (charging) {
      // Wind-up: throwing arm back over the head, chest opened, front arm pointing.
      const k = state.charge;
      q.rSh = 2.2 + 1.2 * k;
      q.rEl = 1.5;
      q.rOut = 0.5;
      q.twist = -0.55 * k;
      q.lean -= 0.25 * k;
      q.lSh = 1.3;
      q.lEl = 0.3;
    }
  }

  if (p.throwT > 0) {
    // Release and follow-through: the arm comes over the top and down across the body.
    const u = clamp(1 - p.throwT / 0.35, 0, 1);
    q.rSh = 2.5 - 2.1 * u;
    q.rEl = 0.5 - 0.3 * u;
    q.rOut = 0.3;
    q.twist = 0.25 + 0.5 * u;
    q.lean += 0.1 + 0.25 * u;
    q.lSh = -0.4;
  }

  // In the air for a jump shot: lead knee up, trailing leg back.
  let air = p.jumpT > 0 ? Math.sin((1 - p.jumpT / 0.5) * Math.PI) : 0;
  if (charging && state.power) air = Math.max(air, state.charge); // a power shot rises as it charges
  if (air > 0) {
    q.rise = Math.max(q.rise, air * 0.55);
    q.lHip = q.lHip * (1 - air) + 0.75 * air;
    q.lKnee = q.lKnee * (1 - air) + 1.3 * air;
    q.rHip = q.rHip * (1 - air) - 0.3 * air;
    q.rKnee = q.rKnee * (1 - air) + 0.7 * air;
  }

  if (state.phase === 'goal') {
    if (p.team === state.lastGoal) {
      // Celebrate: arms pumping overhead, bouncing on the spot.
      q.lSh = q.rSh = 2.9 + Math.sin(t * 10 + p.id) * 0.18;
      q.lOut = q.rOut = 0.3;
      q.lEl = q.rEl = 0.2;
      q.lean = 0;
      q.rise = Math.abs(Math.sin(t * 7 + p.id)) * 0.1;
    } else if (!f.keeper) {
      q.lean = 0.3; // heads drop
      q.lOut = q.rOut = 0.08;
      q.lSh = q.rSh = 0.1;
      q.lEl = q.rEl = 0.2;
    }
  }
}

/** Moves a figure to its player and eases it towards the pose for this moment. */
export function animateFigure(f, p, state, dt) {
  choosePose(f, p, state, dt);
  const k = f.fresh ? 1 : 1 - Math.exp(-BLEND * dt);
  f.fresh = false;
  const q = f.now;
  for (const j of JOINTS) q[j] += (f.want[j] - q[j]) * k;

  f.spine.rotation.set(q.bend, q.twist, -q.lean);
  f.head.rotation.y = q.head;
  f.L.arm.shoulder.rotation.set(q.lOut, 0, q.lSh);
  f.L.arm.elbow.rotation.z = q.lEl;
  f.R.arm.shoulder.rotation.set(-q.rOut, 0, q.rSh);
  f.R.arm.elbow.rotation.z = q.rEl;
  f.L.leg.hip.rotation.set(q.lSplay, 0, q.lHip);
  f.L.leg.knee.rotation.z = -q.lKnee;
  f.L.leg.ankle.rotation.z = q.lKnee - q.lHip; // keeps the sole flat
  f.R.leg.hip.rotation.set(-q.rSplay, 0, q.rHip);
  f.R.leg.knee.rotation.z = -q.rKnee;
  f.R.leg.ankle.rotation.z = q.rKnee - q.rHip;

  // Hips sit at whatever height puts the lower foot on the floor, so a deeper
  // knee bend really does lower the body and a stride really does bob.
  const reach = (hip, knee, splay) => (THIGH * Math.cos(hip) + SHIN * Math.cos(hip - knee)) * Math.cos(splay) + FOOT;
  f.hips.position.y = Math.max(reach(q.lHip, q.lKnee, q.lSplay), reach(q.rHip, q.rKnee, q.rSplay)) + q.rise;
  f.root.position.set(p.x, 0, p.z);
  f.turn.rotation.y = -p.face;
}

const hold = new THREE.Vector3();
/** World position of the figure's throwing hand, for drawing a held ball in it. */
export function gripPosition(f) {
  f.root.updateWorldMatrix(true, true);
  return f.R.arm.grip.getWorldPosition(hold);
}
