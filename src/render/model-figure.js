// Players drawn with a real 3D human model and recorded animation clips.
//
// The model and clips are CC0 files from the Mesh2Motion project (see
// public/models/human/LICENSE-CC0.md). One model is loaded and copied for each
// of the fourteen players, with the team kit painted onto its vertices.
//
// Each frame a player's state picks the clips to play (stand, guard, walk, jog,
// sprint, shuffle, throw, save, celebrate). Their weights ease up and down so
// one movement blends into the next. On top of the clips, the arms can be aimed
// by hand for things no clip covers: carrying the ball, dribbling, arms up to
// block, a keeper spreading himself, a team-mate calling for the pass.
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
// In the throw clip the arm is fully cocked at 0.30 s and the hand lets go just after.
const THROW_COCKED = 0.3;
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
    if (/^spine|^clavicle/.test(bone)) part = y > 1.47 ? 'body' : 'shirt';
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

/** One arm's hand-aimed pose: how strongly it applies, and the directions for upper arm and forearm. */
const newArm = () => ({ w: 0, want: 0, live: false, upper: new THREE.Vector3(), lower: new THREE.Vector3(), tu: new THREE.Vector3(), tl: new THREE.Vector3() });

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
    chest: bone('spine_03'),
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
    saving: null,
    armR: newArm(),
    armL: newArm(),
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

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/** Says where one arm should point: amounts of forward / right / up for the upper arm, then the forearm. */
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
  } else if (p.throwT > 0 && f.throwing !== 'release') {
    // The ball has just left the hand: run on from the cocked arm (a pass skips most of the wind-up).
    thr.time = f.throwing === 'wind' ? Math.max(thr.time, THROW_COCKED) : 0.25;
    thr.timeScale = 1.25;
    thr.paused = false;
    f.throwing = 'release';
  } else if (f.throwing === 'wind') {
    f.throwing = 'no'; // wound up but did not shoot
  } else if (f.throwing === 'release' && p.throwT <= 0 && thr.time > 0.85) {
    f.throwing = 'no';
  }
  const over = f.throwing === 'no' ? 0 : 1; // the throw takes the whole body over from the base clip

  // 3. Keeper save: lunge to the side the shot is going.
  if (f.keeper && shotAtUs) {
    if (!f.saving) {
      const side = (ball.x - p.x) * -sf + (ball.z - p.z) * cf + (ball.vx * -sf + ball.vz * cf) * 0.25;
      f.saving = side > 0 ? 'saveR' : 'saveL';
      f.actions[f.saving].reset().play();
    }
  } else if (f.saving && f.actions[f.saving].time > 0.9) {
    f.saving = null;
  }

  // 4. Ease every clip's weight towards where it should be.
  const k = 1 - Math.exp(-11 * dt);
  for (const name in f.weights) {
    let target = 0;
    if (name === 'throw') target = over;
    else if (name === f.saving) target = over ? 0 : 1;
    else if (name === base) target = over || f.saving ? 0 : 1;
    // The throw has to arrive at once; everything else eases.
    f.weights[name] += (target - f.weights[name]) * (over && (name === 'throw' || name === base) ? Math.min(1, k * 3) : k);
    f.actions[name].setEffectiveWeight(f.weights[name]);
  }
  f.mixer.update(dt);

  // 5. Place him. A jump shot (and a charging power shot) lifts him off the floor.
  let rise = p.jumpT > 0 ? Math.sin((1 - p.jumpT / 0.5) * Math.PI) * 0.55 : 0;
  if (charging && state.power) rise = Math.max(rise, state.charge * 0.55);
  if (p.blocking) rise = Math.max(rise, 0.14);
  f.root.position.set(p.x, rise, p.z);
  f.turn.rotation.y = Math.PI / 2 - p.face;
  f.root.updateMatrixWorld(true);

  // 6. Arms aimed by hand, on top of whatever the clips are doing.
  const R = f.armR;
  const L = f.armL;
  R.want = L.want = 0;
  const still = 1 - Math.min(1, speed / 4);
  if (f.keeper) {
    // Keeper: arms out and up; flung high and wide for a save.
    const big = shotAtUs ? 1 : 0.75;
    pose(R, big, 0.25, 1, shotAtUs ? 0.7 : 0.15, 0.3, 0.5, 1);
    pose(L, big, 0.25, -1, shotAtUs ? 0.7 : 0.15, 0.3, -0.5, 1);
  } else if (defending && !p.hasBall) {
    // Defender in the wall: hands up and out, less so while he is running.
    pose(R, 0.25 + 0.6 * still, 0.35, 0.9, 0.2, 0.35, 0.35, 1);
    pose(L, 0.25 + 0.6 * still, 0.35, -0.9, 0.2, 0.35, -0.35, 1);
  }
  if (p.blocking || (shotAtUs && !f.keeper && Math.hypot(ball.x - p.x, ball.z - p.z) < 2.6)) {
    // Arms straight up to block: on command, or by reflex when a shot comes close.
    pose(R, 1, 0.1, 0.18, 1, 0.05, 0.05, 1);
    pose(L, 1, 0.1, -0.18, 1, 0.05, -0.05, 1);
  }
  if (state.passTarget === p.id) pose(L, 1, 0.2, -0.3, 1, 0.1, -0.1, 1); // "pass it here"
  if (p.hasBall && f.throwing === 'no') {
    if (p.dribbling) {
      const pump = 0.45 + 0.35 * Math.abs(Math.sin(state.time * 9));
      pose(R, 1, 0.35, 0.35, -1, 0.9, 0.2, -pump);
    } else {
      pose(R, 1, 0.45, 0.4, -0.75, 0.6, 0.05, 0.8); // ball held at the shoulder
    }
  }
  easeArm(R, f.B.upperR, f.B.lowerR, f.B.handR, f.throwing === 'no', k);
  easeArm(L, f.B.upperL, f.B.lowerL, f.B.handL, f.throwing === 'no', k);
}

/** Eases an arm towards its hand-aimed pose and applies it. The throw clip owns the arms while it plays. */
function easeArm(arm, upper, lower, hand, allowed, k) {
  if (arm.want > 0) {
    // Ease the directions too, unless the arm was at rest, when it starts from the new pose.
    arm.upper.lerp(arm.tu, arm.live ? k : 1).normalize();
    arm.lower.lerp(arm.tl, arm.live ? k : 1).normalize();
    arm.live = true;
  }
  arm.w += ((allowed ? arm.want : 0) - arm.w) * k;
  if (arm.w < 0.01) {
    if (arm.want === 0) arm.live = false;
    return;
  }
  aim(upper, lower, arm.upper, arm.w);
  aim(lower, hand, arm.lower, arm.w);
}

const hold = new THREE.Vector3();
/** World position of the throwing hand, for drawing a held ball in it. */
export function modelGrip(f) {
  f.root.updateWorldMatrix(true, true);
  return f.grip.getWorldPosition(hold);
}
