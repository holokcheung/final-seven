// Players drawn with a real 3D human model and recorded animation clips.
//
// The model and clips are CC0 files from the Mesh2Motion project (see
// public/models/human/LICENSE-CC0.md). One model is loaded and copied for each
// of the fourteen players, with the team kit painted onto its vertices.
//
// Each frame a player's state picks the clips to play (stand, guard, walk, jog,
// sprint, shuffle, throw, save, celebrate). Their weights ease up and down so
// one movement blends into the next. On top of the clips, the arms can be aimed
// and legs can be aimed by hand for the handball moves no clip covers: catching
// with both hands, a push pass on the run, the legs and back arch of a jump shot
// and its landing, hands on an attacker, arms up to block, and a keeper's high,
// low and leg saves.
//
// The model faces +z and its right hand is on -x.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp } from '../sim/core.js';
import { makeNumberTexture } from './textures.js';

const CLIPS = {
  idle: 'idle-a',
  guard: 'fighting-idle',
  walk: 'walk',
  jog: 'jog',
  sprint: 'sprint',
  strafeL: 'strafe-left', // towards the character's left
  strafeR: 'strafe-right',
  throw: 'overhandthrow',
  victory: 'victory',
  saveR: 'dodge-left', // this clip moves the body to the character's right
  saveL: 'dodge-right',
};
const ONE_SHOT = new Set(['throw', 'saveL', 'saveR']);
// Ground speed (m/s) each clip looks right at, measured from its stride.
const PACE = { walk: 0.9, jog: 2.8, sprint: 4.8, strafeL: 0.9, strafeR: 0.9 };
// In the throw clip the arm is drawn back by 0.27 s, comes over the top at 0.30 s
// and the hand lets go just after.
const THROW_COCKED = 0.27;
const SCALE = 1.04; // the model is 1.83 m; handball players are a little taller
const BODY = '#b3bac7'; // bare parts are a plain mannequin grey: no likeness, and white shorts still show
const SHOE = '#1b1e26';
const SOCK = '#f4f4f4';

/** Loads the model and every clip. Rejects if any file is missing, so the caller can fall back. */
export async function loadPlayerAssets(baseUrl) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const dir = baseUrl + 'models/human/';
  const names = Object.keys(CLIPS);
  const [model, ...files] = await Promise.all([
    loader.loadAsync(dir + 'model.glb'),
    ...names.map((n) => loader.loadAsync(`${dir}animations/${CLIPS[n]}.glb`)),
  ]);
  const clips = {};
  names.forEach((n, i) => {
    clips[n] = files[i].animations[0];
  });
  let mesh = null;
  model.scene.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
  });
  if (!mesh) throw new Error('player model has no skinned mesh');
  return { scene: model.scene, meshName: mesh.name, clips, kits: new Map() };
}

/**
 * Paints a kit onto a copy of the model's geometry. Each vertex takes the colour
 * of the body part it belongs to, found from the bone that moves it most and
 * where it sits in the T-pose: short sleeves, shorts to mid-thigh, socks, shoes.
 * Keepers get long sleeves and long trousers.
 */
function paintKit(mesh, kit) {
  const geo = mesh.geometry.clone();
  const pos = geo.attributes.position;
  const index = geo.attributes.skinIndex;
  const weight = geo.attributes.skinWeight;
  const bones = mesh.skeleton.bones;
  const colors = new Float32Array(pos.count * 3);
  const palette = Object.fromEntries(Object.entries({ shirt: kit.shirt, shorts: kit.shorts, sock: SOCK, shoe: SHOE, body: BODY }).map(([k, c]) => [k, new THREE.Color(c)]));
  for (let i = 0; i < pos.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weight.getComponent(i, k) > weight.getComponent(i, best)) best = k;
    const bone = bones[index.getComponent(i, best)].name;
    const x = Math.abs(pos.getX(i));
    const y = pos.getY(i);
    let part = 'body';
    if (/^spine|^clavicle/.test(bone)) part = y > 1.53 ? 'body' : 'shirt';
    else if (/^upperarm/.test(bone)) part = kit.long || x < 0.34 ? 'shirt' : 'body';
    else if (/^lowerarm/.test(bone)) part = kit.long ? 'shirt' : 'body';
    else if (bone === 'pelvis') part = 'shorts';
    else if (/^thigh/.test(bone)) part = kit.long || y > 0.72 ? 'shorts' : 'body';
    else if (/^calf/.test(bone)) part = kit.long ? 'shorts' : y < 0.29 ? 'sock' : 'body';
    else if (/^foot|^ball/.test(bone)) part = 'shoe';
    const c = palette[part];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const kitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });

/**
 * A limb (arm or leg) posed by hand: how strongly the pose applies, and the
 * directions its two segments should point (upper arm + forearm, or thigh + shin).
 */
const newLimb = () => ({ w: 0, want: 0, live: false, snap: false, upper: new THREE.Vector3(), lower: new THREE.Vector3(), tu: new THREE.Vector3(), tl: new THREE.Vector3() });

export function buildModelFigure(team, pl, assets) {
  const keeper = pl.pos === 'GK';
  const model = cloneSkinned(assets.scene);
  let mesh = null;
  model.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
  });

  const kitKey = team.code + (keeper ? ':GK' : '');
  if (!assets.kits.has(kitKey)) {
    assets.kits.set(kitKey, paintKit(mesh, keeper ? { shirt: team.keeper, shorts: team.keeper, long: true } : { shirt: team.shirt, shorts: team.shorts }));
  }
  mesh.geometry = assets.kits.get(kitKey);
  mesh.material = kitMaterial;
  mesh.castShadow = true;
  mesh.frustumCulled = false; // a skinned mesh moves well outside its rest-pose bounds

  const root = new THREE.Group(); // sits at the player's spot on the court
  const turn = new THREE.Group(); // faces him the right way
  turn.scale.setScalar(SCALE);
  turn.add(model);
  root.add(turn);
  root.updateMatrixWorld(true);

  const bone = (name) => model.getObjectByName(name);
  const B = {
    upperR: bone('upperarm_r'), lowerR: bone('lowerarm_r'), handR: bone('hand_r'),
    upperL: bone('upperarm_l'), lowerL: bone('lowerarm_l'), handL: bone('hand_l'),
    thighR: bone('thigh_r'), calfR: bone('calf_r'), footR: bone('foot_r'),
    thighL: bone('thigh_l'), calfL: bone('calf_l'), footL: bone('foot_l'),
    spine: bone('spine_02'), chest: bone('spine_03'), neck: bone('neck_01'), head: bone('head'),
  };

  // Things fixed to bones, placed while the model is still in its T-pose.
  const grip = new THREE.Object3D(); // where a held ball sits: in the right palm
  grip.position.copy(B.handR.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(-0.1 * SCALE, -0.09 * SCALE, 0.02));
  root.add(grip);
  B.handR.attach(grip);

  const number = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: makeNumberTexture(pl.num, '#ffffff'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  number.position.set(0, 1.3 * SCALE, -0.135 * SCALE); // on the back
  number.rotation.y = Math.PI;
  root.add(number);
  B.chest.attach(number);

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeNumberTexture(pl.num, '#ffffff'), depthWrite: false }));
  label.scale.set(0.5, 0.5, 1);
  label.position.y = 2.3;
  root.add(label);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  const weights = {};
  for (const [name, clip] of Object.entries(assets.clips)) {
    const a = mixer.clipAction(clip);
    if (ONE_SHOT.has(name)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    a.time = (pl.num * 0.37) % clip.duration; // so fourteen players are not in step
    actions[name] = a;
    weights[name] = 0;
  }
  weights.idle = 1;
  actions.idle.setEffectiveWeight(1);

  return {
    root, turn, model, B, grip, keeper, mixer, actions, weights,
    base: 'idle',
    throwing: 'no', // 'no' | 'wind' (charging a shot) | 'release' (ball gone, following through)
    since: 0, // seconds since the shot was released
    saving: null, // which lunge clip a keeper is playing
    save: { side: 0, h: 1, hold: 0 }, // keeper: where the shot is heading, and how long to hold the save
    armR: newLimb(), armL: newLimb(), legR: newLimb(), legL: newLimb(),
    air: 0, land: 0, // jump shot: how far through the jump, and time left in the landing crouch
    lean: 0, pitch: 0, look: 0, // eased sideways lean, back arch and head turn
  };
}

// ---- aiming a limb by hand ------------------------------------------------

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const swing = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const parentInv = new THREE.Quaternion();
const none = new THREE.Quaternion();

/** Turns `bone` so the line from it to `child` points along `dir` (world space), by `amount` 0..1. */
function aim(bone, child, dir, amount) {
  bone.getWorldPosition(a);
  child.getWorldPosition(b);
  b.sub(a).normalize();
  swing.setFromUnitVectors(b, dir);
  if (amount < 1) swing.copy(none.identity().slerp(swing, amount));
  // world' = swing * world, so local' = parent^-1 * swing * parent * local
  bone.parent.getWorldQuaternion(parentQ);
  parentInv.copy(parentQ).invert();
  bone.quaternion.premultiply(swing.premultiply(parentInv).multiply(parentQ));
  bone.updateMatrixWorld(true);
}

/** Rotates `bone` by `angle` about a world-space axis: used to arch the back and turn the head. */
function tilt(bone, axis, angle) {
  swing.setFromAxisAngle(axis, angle);
  bone.parent.getWorldQuaternion(parentQ);
  parentInv.copy(parentQ).invert();
  bone.quaternion.premultiply(swing.premultiply(parentInv).multiply(parentQ));
  bone.updateMatrixWorld(true);
}

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const spot = new THREE.Vector3();

/** Points a whole limb straight at a place in the world: reaching for a ball, or for an opponent. */
function reach(limb, amount, from, point) {
  from.getWorldPosition(a);
  limb.want = amount;
  limb.tu.copy(point).sub(a).normalize();
  limb.tl.copy(limb.tu);
}

/** Says where a limb should point: amounts of forward / right / up for its upper segment, then its lower one. */
function pose(arm, amount, uf, ur, uu, lf, lr, lu) {
  arm.want = amount;
  arm.tu.set(0, 0, 0).addScaledVector(fwd, uf).addScaledVector(right, ur).addScaledVector(up, uu).normalize();
  arm.tl.set(0, 0, 0).addScaledVector(fwd, lf).addScaledVector(right, lr).addScaledVector(up, lu).normalize();
}

// ---- per-frame animation ---------------------------------------------------

export function animateModelFigure(f, p, state, dt) {
  const ball = state.ball;
  const speed = Math.hypot(p.vx, p.vz);
  const cf = Math.cos(p.face);
  const sf = Math.sin(p.face);
  fwd.set(cf, 0, sf);
  right.set(-sf, 0, cf);
  const defending = state.possTeam !== p.team;
  const shotAtUs = ball.holder == null && ball.kind === 'shot' && ball.byTeam !== p.team;
  const charging = p.id === state.ctrl && state.charge > 0;
  const celebrating = state.phase === 'goal' && p.team === state.lastGoal;

  // 1. Which clip carries the body. A little stickiness stops it flickering between two.
  const ahead = p.vx * cf + p.vz * sf;
  const across = p.vx * -sf + p.vz * cf; // + is to his right
  const stance = f.keeper || defending ? 'guard' : 'idle';
  const standing = f.base === 'idle' || f.base === 'guard';
  let base;
  if (celebrating) base = 'victory';
  else if (speed < (standing ? 0.7 : 0.4)) base = stance;
  else if (stance === 'guard' && speed < 3 && Math.abs(across) > Math.abs(ahead) * 1.3) base = across > 0 ? 'strafeR' : 'strafeL';
  else if (speed < (f.base === 'walk' ? 1.9 : 1.5)) base = 'walk';
  else if (speed < (f.base === 'sprint' ? 3.5 : f.base === 'jog' ? 4.4 : 3.9)) base = 'jog';
  else base = 'sprint';
  f.base = base;
  if (PACE[base]) f.actions[base].timeScale = clamp(speed / PACE[base], 0.7, 1.7);

  // 2. The throw. While a shot is charged the clip is held on the wind-up, scrubbed
  //    by the charge; on release it runs on through the follow-through.
  const thr = f.actions.throw;
  if (charging) {
    f.throwing = 'wind';
    thr.paused = true;
    thr.time = 0.04 + state.charge * (THROW_COCKED - 0.04);
  } else if (p.throwT > 0 && p.throwKind !== 'pass' && f.throwing !== 'release') {
    // A shot has just left the hand. (A pass is not a full-body throw; it is a quick
    // push with the arm, done further down, so the legs keep running.)
    f.throwing = 'release';
    f.since = 0;
  } else if (f.throwing === 'wind') {
    f.throwing = 'no'; // wound up but did not shoot
  } else if (f.throwing === 'release') {
    f.since += dt;
    if (f.since > 0.6) f.throwing = 'no';
  }
  if (f.throwing === 'release') {
    // The clip is a standing throw that folds right over afterwards. A jump shot is
    // different, so its frames are picked by hand: the arm whips over the top, he
    // hangs in the air barely following through, and only folds a little as he lands.
    const u = f.since;
    thr.paused = true;
    thr.time = u < 0.1 ? 0.3 + 0.7 * u : u < 0.4 ? 0.37 + (0.04 * (u - 0.1)) / 0.3 : 0.41 + 0.06 * Math.min(1, (u - 0.4) / 0.2);
  }
  const over = f.throwing === 'no' ? 0 : 1; // the throw takes the whole body over from the base clip

  // 3. Keeper save. Work out where the shot will arrive (how far to his right, how
  //    high) so the save can go there, and hold the shape for a moment afterwards.
  const k = 1 - Math.exp(-11 * dt);
  let save = null;
  if (f.keeper) {
    if (shotAtUs) {
      const v2 = ball.vx * ball.vx + ball.vz * ball.vz || 1;
      const t = clamp(((p.x - ball.x) * ball.vx + (p.z - ball.z) * ball.vz) / v2, 0, 1);
      f.save.side = (ball.x + ball.vx * t - p.x) * -sf + (ball.z + ball.vz * t - p.z) * cf;
      f.save.h = Math.max(0.1, ball.y + ball.vy * t - 4.9 * t * t);
      if (f.save.hold <= 0) {
        f.saving = f.save.side > 0 ? 'saveR' : 'saveL'; // step and lunge that way
        f.actions[f.saving].reset().play();
      }
      f.save.hold = 0.4;
    } else if (f.save.hold > 0) {
      f.save.hold -= dt;
      if (f.save.hold <= 0) f.saving = null;
    }
    if (f.save.hold > 0) save = f.save;
  }

  // 4. Ease every clip's weight towards where it should be.
  for (const name in f.weights) {
    let target = 0;
    if (name === 'throw') target = over;
    else if (name === f.saving) target = over ? 0 : 0.65;
    else if (name === base) target = over ? 0 : f.saving ? 0.35 : 1;
    // The throw has to arrive at once; everything else eases.
    f.weights[name] += (target - f.weights[name]) * (over && (name === 'throw' || name === base) ? Math.min(1, k * 3) : k);
    f.actions[name].setEffectiveWeight(f.weights[name]);
  }
  f.mixer.update(dt);

  // 5. Place him. A jump shot lifts him off the floor (a power shot rises as it
  //    charges) and he sinks into his knees for a moment when he lands.
  let air = p.jumpT > 0 ? Math.sin((1 - p.jumpT / 0.5) * Math.PI) : 0;
  if (charging && state.power) air = Math.max(air, state.charge);
  if (f.air > 0.05 && air <= 0.05) f.land = 0.3; // touched down
  f.air = air;
  f.land = Math.max(0, f.land - dt);
  const crouch = Math.sin((f.land / 0.3) * Math.PI) * 0.9;
  let rise = air * 0.55 - crouch * 0.09;
  if (p.blocking) rise = Math.max(rise, 0.14);
  let lean = 0; // sideways lean from the feet, + is to his right
  if (save) {
    const far = clamp(save.side / 1.2, -1, 1);
    lean = far * (save.h < 0.9 ? 0.2 : 0.42);
    if (save.h > 1.5) rise += 0.08 + 0.2 * Math.abs(far); // goes up for a high one
  }
  f.lean += (lean - f.lean) * Math.min(1, k * 1.6);
  f.root.position.set(p.x, rise, p.z);
  f.root.quaternion.setFromAxisAngle(fwd, f.lean);
  f.turn.rotation.y = Math.PI / 2 - p.face;
  f.root.updateMatrixWorld(true);

  // 6. The body, posed by hand on top of whatever the clips are doing.
  //    Back first, then head, then the limbs, because each moves what hangs off it.
  let pitch = 0; // + arches back
  if (f.throwing === 'wind') pitch = 0.24 * state.charge;
  else if (f.throwing === 'release') pitch = 0.14 * air; // a touch taller while he hangs in the air
  f.pitch += (pitch - f.pitch) * k;
  if (Math.abs(f.pitch) > 0.004) tilt(f.B.spine, right, f.pitch);

  // Eyes on the ball, unless he has it.
  let look = 0;
  if (!p.hasBall && !celebrating) {
    look = Math.atan2(ball.z - p.z, ball.x - p.x) - p.face;
    while (look > Math.PI) look -= 2 * Math.PI;
    while (look < -Math.PI) look += 2 * Math.PI;
    look = clamp(look, -1.1, 1.1) * 0.8;
  }
  f.look += (look - f.look) * k;
  if (Math.abs(f.look) > 0.01) {
    tilt(f.B.neck, up, -f.look * 0.5);
    tilt(f.B.head, up, -f.look * 0.5);
  }

  const R = f.armR;
  const L = f.armL;
  const legR = f.legR;
  const legL = f.legL;
  R.want = L.want = legR.want = legL.want = 0;
  const still = 1 - Math.min(1, speed / 4);
  const carrier = ball.holder != null ? state.players[ball.holder] : null;

  if (f.keeper && save) {
    // Throw the near hand at the ball. A high ball close to the body gets both hands;
    // a low one wide of him gets a leg kicked out along the floor as well.
    const side = clamp(save.side, -1.15, 1.15);
    const sgn = side > 0 ? 1 : -1;
    spot.set(p.x, clamp(save.h, 0.15, 2.4), p.z).addScaledVector(right, side).addScaledVector(fwd, 0.25);
    const [near, nearFrom, other, otherFrom] = sgn > 0 ? [R, f.B.upperR, L, f.B.upperL] : [L, f.B.upperL, R, f.B.upperR];
    reach(near, 1, nearFrom, spot);
    if (save.h > 1.2 && Math.abs(side) < 0.6) reach(other, 1, otherFrom, spot);
    else pose(other, 0.8, 0.2, -sgn * 0.8, 0.5, 0.3, -sgn * 0.4, 1);
    if (save.h < 0.9 && Math.abs(side) > 0.3) pose(sgn > 0 ? legR : legL, 1, 0.15, sgn, -0.45, 0.1, sgn, -0.35);
  } else if (f.keeper) {
    // Ready: hands up beside the head, making himself big.
    pose(R, 0.75, 0.25, 1, 0.15, 0.3, 0.5, 1);
    pose(L, 0.75, 0.25, -1, 0.15, 0.3, -0.5, 1);
  } else if (defending && !p.hasBall) {
    if (carrier && carrier.team !== p.team && carrier.role !== 'GK' && Math.hypot(carrier.x - p.x, carrier.z - p.z) < 1.4) {
      // Right on the attacker: hands on his chest, as defenders do.
      spot.set(carrier.x, 1.3, carrier.z);
      reach(R, 0.9, f.B.upperR, spot);
      reach(L, 0.9, f.B.upperL, spot);
    } else {
      // In the wall: hands up and out, less so while he is running.
      pose(R, 0.25 + 0.6 * still, 0.35, 0.9, 0.2, 0.35, 0.35, 1);
      pose(L, 0.25 + 0.6 * still, 0.35, -0.9, 0.2, 0.35, -0.35, 1);
    }
  }
  if (p.blocking || (shotAtUs && !f.keeper && Math.hypot(ball.x - p.x, ball.z - p.z) < 2.6)) {
    // Arms straight up to block: on command, or by reflex when a shot comes close.
    pose(R, 1, 0.1, 0.18, 1, 0.05, 0.05, 1);
    pose(L, 1, 0.1, -0.18, 1, 0.05, -0.05, 1);
  }
  if (state.passTarget === p.id) pose(L, 1, 0.2, -0.3, 1, 0.1, -0.1, 1); // "pass it here"

  // Catching: as a pass arrives, both hands go out to meet it.
  if (ball.holder == null && ball.kind === 'pass' && ball.target === p.id) {
    const arrives = Math.hypot(ball.x - p.x, ball.z - p.z) / Math.max(4, Math.hypot(ball.vx, ball.vz));
    if (arrives < 0.5) {
      const w = clamp((0.5 - arrives) / 0.25, 0, 1);
      spot.set(ball.x, ball.y, ball.z);
      reach(R, w, f.B.upperR, spot);
      reach(L, w, f.B.upperL, spot);
    }
  }

  if (p.hasBall && f.throwing === 'no') {
    if (p.dribbling) {
      const pump = 0.45 + 0.35 * Math.abs(Math.sin(state.time * 9));
      pose(R, 1, 0.35, 0.35, -1, 0.9, 0.2, -pump);
    } else if (speed < 1.2 && !f.keeper) {
      // Standing with it: held in both hands in front of the chest.
      pose(R, 1, 0.6, 0.22, -0.7, 0.75, -0.35, 0.5);
      pose(L, 1, 0.6, -0.22, -0.7, 0.75, 0.35, 0.5);
    } else {
      pose(R, 1, 0.45, 0.4, -0.75, 0.6, 0.05, 0.8); // on the move: carried at the shoulder
    }
  }

  // A pass: the throwing arm pushes straight out after the ball, while the legs keep running.
  if (p.throwT > 0 && p.throwKind === 'pass') {
    spot.set(ball.x, Math.max(1.25, ball.y), ball.z);
    reach(R, 1, f.B.upperR, spot);
    R.snap = true;
  }

  // Legs in the air for a jump shot: throwing-side knee driven up and out, the
  // other leg trailing. Then a short crouch to take the landing.
  if (air > 0.05 && !f.keeper) {
    pose(legR, air, 0.55, 0.45, -0.45, -0.35, 0.1, -1);
    pose(legL, air, -0.3, -0.05, -1, -0.75, 0, -0.7);
  } else if (crouch > 0.05) {
    pose(legR, crouch, 0.42, 0.08, -1, -0.5, 0.05, -1);
    pose(legL, crouch, 0.42, -0.08, -1, -0.5, -0.05, -1);
  }

  const armsFree = f.throwing === 'no'; // the throw clip owns the arms while it plays
  easeLimb(R, f.B.upperR, f.B.lowerR, f.B.handR, armsFree, k);
  easeLimb(L, f.B.upperL, f.B.lowerL, f.B.handL, armsFree, k);
  easeLimb(legR, f.B.thighR, f.B.calfR, f.B.footR, true, k);
  easeLimb(legL, f.B.thighL, f.B.calfL, f.B.footL, true, k);
}

/** Eases a limb towards its hand-set pose and applies it. `snap` skips the easing for one frame. */
function easeLimb(limb, upper, lower, end, allowed, k) {
  if (limb.want > 0) {
    // Ease the directions too, unless the limb was at rest, when it starts from the new pose.
    const step = limb.live && !limb.snap ? k : 1;
    limb.upper.lerp(limb.tu, step).normalize();
    limb.lower.lerp(limb.tl, step).normalize();
    limb.live = true;
  }
  const goal = allowed ? limb.want : 0;
  limb.w = limb.snap ? goal : limb.w + (goal - limb.w) * k;
  limb.snap = false;
  if (limb.w < 0.01) {
    if (limb.want === 0) limb.live = false;
    return;
  }
  aim(upper, lower, limb.upper, limb.w);
  aim(lower, end, limb.lower, limb.w);
}

const hold = new THREE.Vector3();
/** World position of the throwing hand, for drawing a held ball in it. */
export function modelGrip(f) {
  f.root.updateWorldMatrix(true, true);
  return f.grip.getWorldPosition(hold);
}
