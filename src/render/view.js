// Everything you see in 3D: arena, goals, players, ball and cameras.
// The view only reads the match state; it never changes it.

import * as THREE from 'three';
import { HALF_L, HALF_W, GOAL_HALF, GOAL_H, clamp } from '../sim/core.js';
import { COURT_MARGIN, makeCourtTexture, makeCrowdTexture, makeBoardTexture, makeNetTexture, makeNumberTexture } from './textures.js';

const SKIN = ['#f0cba8', '#e2b48c', '#c98f63', '#8d5a3b'];
const CAMERAS = ['broadcast', 'end', 'top'];

function buildArena(scene, teams) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * (HALF_L + COURT_MARGIN), 2 * (HALF_W + COURT_MARGIN)),
    new THREE.MeshStandardMaterial({ map: makeCourtTexture(), roughness: 0.55 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(160, 120), new THREE.MeshStandardMaterial({ color: 0x0c1c2c, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  scene.add(apron);

  // Boards round the court.
  const boardMat = new THREE.MeshStandardMaterial({ map: makeBoardTexture('FINAL SEVEN   •   DENMARK  v  FRANCE   •'), roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b1b2c, roughness: 0.8 });
  const bx = HALF_L + COURT_MARGIN;
  const bz = HALF_W + COURT_MARGIN;
  for (const sgn of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(2 * bx, 0.9, 0.2), sgn < 0 ? boardMat : dark);
    side.position.set(0, 0.45, sgn * bz);
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 2 * bz), dark);
    end.position.set(sgn * bx, 0.45, 0);
    scene.add(side, end);
  }

  // Stands: sloped banks of supporters on all four sides. They only draw from the
  // court side, so a camera sitting up in a stand looks straight through it.
  const crowd = new THREE.MeshBasicMaterial({ map: makeCrowdTexture([teams[0].shirt, teams[1].shirt]), color: 0x77828f });
  const bank = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 15), crowd);
    const holder = new THREE.Group();
    m.rotation.x = -0.62;
    m.position.y = 6.6;
    holder.add(m);
    holder.position.set(x, 0, z);
    holder.rotation.y = rotY;
    scene.add(holder);
  };
  bank(62, 0, -(bz + 5.2), 0);
  bank(62, 0, bz + 5.2, Math.PI);
  bank(52, -(bx + 9), 0, Math.PI / 2);
  bank(52, bx + 9, 0, -Math.PI / 2);
}

function buildGoal(sgn) {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xd3142f, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
  const post = new THREE.BoxGeometry(0.08, 0.2, 0.08);
  const bar = new THREE.BoxGeometry(0.08, 0.08, 0.2);
  for (let i = 0; i < 10; i++) {
    for (const z of [-GOAL_HALF - 0.04, GOAL_HALF + 0.04]) {
      const m = new THREE.Mesh(post, i % 2 ? white : red);
      m.position.set(0, 0.1 + i * 0.2, z);
      m.castShadow = true;
      g.add(m);
    }
  }
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(bar, i % 2 ? white : red);
    m.position.set(0, GOAL_H + 0.04, -GOAL_HALF - 0.04 + 0.1 + i * 0.1925);
    g.add(m);
  }
  const net = new THREE.MeshBasicMaterial({ map: makeNetTexture(), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * GOAL_HALF, GOAL_H), net);
  back.rotation.y = Math.PI / 2;
  back.position.set(sgn * 1, GOAL_H / 2, 0);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(1, 2 * GOAL_HALF), net);
  top.rotation.x = -Math.PI / 2;
  top.position.set(sgn * 0.5, GOAL_H, 0);
  g.add(back, top);
  for (const z of [-GOAL_HALF, GOAL_HALF]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1, GOAL_H), net);
    side.position.set(sgn * 0.5, GOAL_H / 2, z);
    g.add(side);
  }
  g.position.x = sgn * (HALF_L + 0.04);
  return g;
}

/** A simple jointed figure, facing +x, with hips and shoulders that swing. */
function buildPlayer(team, pl, index) {
  const keeper = pl.pos === 'GK';
  const shirt = new THREE.MeshStandardMaterial({ color: keeper ? team.keeper : team.shirt, roughness: 0.7 });
  const shorts = new THREE.MeshStandardMaterial({ color: keeper ? team.keeper : team.shorts, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: SKIN[(index * 3 + pl.num) % SKIN.length], roughness: 0.8 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  add(new THREE.CapsuleGeometry(0.2, 0.4, 4, 10), shirt, 0, 1.2, 0);
  add(new THREE.CylinderGeometry(0.2, 0.19, 0.26, 10), shorts, 0, 0.86, 0);
  add(new THREE.SphereGeometry(0.135, 14, 10), skin, 0, 1.7, 0);

  const limb = (len, thick, mat, x, y, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    add(new THREE.BoxGeometry(thick, len, thick), mat, 0, -len / 2, 0, pivot);
    body.add(pivot);
    return pivot;
  };
  const legL = limb(0.76, 0.13, skin, 0, 0.78, -0.1);
  const legR = limb(0.76, 0.13, skin, 0, 0.78, 0.1);
  const armL = limb(0.56, 0.1, skin, 0, 1.44, -0.27);
  const armR = limb(0.56, 0.1, skin, 0, 1.44, 0.27);

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeNumberTexture(pl.num, '#ffffff'), depthWrite: false }));
  label.scale.set(0.62, 0.62, 1);
  label.position.y = 2.2;
  root.add(label);
  return { root, body, legL, legR, armL, armR, stride: index, keeper };
}

export function createView(canvas, teams) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07111c);
  scene.fog = new THREE.Fog(0x07111c, 70, 150);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 300);

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x1a2a3a, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-8, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 16, bottom: -16, near: 5, far: 70 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  buildArena(scene, teams);
  scene.add(buildGoal(-1), buildGoal(1));

  const figures = [];
  teams.forEach((team) => {
    for (const pl of team.players) {
      const f = buildPlayer(team, pl, figures.length);
      figures.push(f);
      scene.add(f.root);
    }
  });

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfff7e0, roughness: 0.45, emissive: 0x332a10 }));
  ball.castShadow = true;
  scene.add(ball);

  // Marker under the player you control, and a faint one under whoever your pass would go to.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);

  let mode = 0;
  const focus = new THREE.Vector3();
  const forward = { x: 0, z: -1 };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep roughly the same width of court in view whatever the window shape.
    camera.fov = clamp((2 * Math.atan(0.6 / camera.aspect) * 180) / Math.PI, 38, 62);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function placeCamera(state, dt) {
    const b = state ? state.ball : { x: 0, z: 0 };
    const k = 1 - Math.exp(-4 * dt);
    focus.x += (clamp(b.x * 0.8, -13, 13) - focus.x) * k;
    focus.z += (b.z - focus.z) * k;
    camera.up.set(0, 1, 0);
    const name = CAMERAS[mode];
    if (!state) {
      // Menu: a slow sweep round the empty arena.
      const a = performance.now() / 9000;
      camera.position.set(Math.cos(a) * 34, 15, Math.sin(a) * 30);
      camera.lookAt(0, 1, 0);
    } else if (name === 'end') {
      const d = state.humanTeam != null ? state.teams[state.humanTeam].dir : 1;
      camera.position.set(clamp(focus.x - d * 15, -30, 30), 8.5, focus.z * 0.45);
      camera.lookAt(focus.x + d * 6, 1, focus.z * 0.6);
      forward.x = d;
      forward.z = 0;
      return;
    } else if (name === 'top') {
      camera.up.set(0, 0, -1);
      camera.position.set(focus.x * 0.6, 38, 0.01);
      camera.lookAt(focus.x * 0.6, 0, 0);
    } else {
      camera.position.set(focus.x, 15, 26);
      camera.lookAt(focus.x, 0.5, focus.z * 0.2 - 1);
    }
    forward.x = 0;
    forward.z = -1;
  }

  function poseFigures(state, dt) {
    const celebrating = state.phase === 'goal' ? state.lastGoal : -1;
    for (const p of state.players) {
      const f = figures[p.id];
      const speed = Math.hypot(p.vx, p.vz);
      let jump = p.jumpT > 0 ? Math.sin((1 - p.jumpT / 0.5) * Math.PI) * 0.55 : 0;
      // Winding up a power shot: rise into the jump as the charge builds.
      if (p.id === state.ctrl && state.power && state.charge > 0) jump = Math.max(jump, state.charge * 0.55);
      f.root.position.set(p.x, jump, p.z);
      f.body.rotation.y = -p.face;
      f.stride += speed * dt * 2.3;
      const swing = Math.sin(f.stride) * Math.min(1, speed / 4) * 0.9;
      f.legL.rotation.set(0, 0, swing);
      f.legR.rotation.set(0, 0, -swing);
      f.armL.rotation.set(0, 0, -swing * 0.8);
      f.armR.rotation.set(0, 0, swing * 0.8);
      f.body.rotation.z = 0;
      const charging = p.id === state.ctrl && state.charge > 0;
      if (p.throwT > 0 || charging) {
        f.armR.rotation.set(0, 0, 2.7); // throwing arm cocked overhead
      } else if (p.team === celebrating) {
        f.armL.rotation.set(0, 0, 2.9);
        f.armR.rotation.set(0, 0, 2.9);
      } else if (f.keeper) {
        // Keeper stands big, and leans into a save.
        f.armL.rotation.set(2.0, 0, 0);
        f.armR.rotation.set(-2.0, 0, 0);
        const b = state.ball;
        if (b.holder == null && b.kind === 'shot' && b.byTeam !== p.team) f.body.rotation.x = clamp((b.z - p.z) * 0.5, -0.7, 0.7) * Math.cos(p.face);
        else f.body.rotation.x = 0;
      } else if (state.possTeam !== p.team && speed < 2.5) {
        // Defenders in the wall keep their arms up.
        f.armL.rotation.set(1.3, 0, 2.2);
        f.armR.rotation.set(-1.3, 0, 2.2);
      }
    }
  }

  function poseBall(state) {
    const b = state.ball;
    if (b.holder == null) {
      ball.position.set(b.x, Math.max(0.17, b.y), b.z);
      return;
    }
    const p = state.players[b.holder];
    const speed = Math.hypot(p.vx, p.vz);
    const side = { x: -Math.sin(p.face) * 0.3, z: Math.cos(p.face) * 0.3 };
    if (p.id === state.ctrl && state.charge > 0) {
      ball.position.set(p.x + side.x, 2.05, p.z + side.z); // wound up to shoot
    } else if (p.dribbling) {
      // The one dribble: the ball bounces beside the runner.
      const y = 0.17 + Math.abs(Math.sin(state.time * 9)) * 0.85;
      ball.position.set(p.x + Math.cos(p.face) * 0.45 + side.x, y, p.z + Math.sin(p.face) * 0.45 + side.z);
    } else {
      // Carried in the throwing hand, swinging a little with each of the three steps.
      const y = 1.25 + Math.sin(p.steps * 5.5) * Math.min(1, speed / 3) * 0.12;
      ball.position.set(p.x + Math.cos(p.face) * 0.25 + side.x, y, p.z + Math.sin(p.face) * 0.25 + side.z);
    }
  }

  return {
    /** Ground direction that "up" on the keyboard should move you, for the current camera. */
    forward: () => forward,
    cameraName: () => CAMERAS[mode],
    nextCamera() {
      mode = (mode + 1) % CAMERAS.length;
      return CAMERAS[mode];
    },
    render(state, dt) {
      placeCamera(state, dt);
      const playing = !!state;
      for (const f of figures) f.root.visible = playing;
      ball.visible = playing;
      ring.visible = playing && state.ctrl != null;
      if (playing) {
        poseFigures(state, dt);
        poseBall(state);
        if (state.ctrl != null) {
          const p = state.players[state.ctrl];
          ring.position.set(p.x, 0.04, p.z);
          ring.scale.setScalar(1 + Math.sin(state.time * 6) * 0.06);
        }
      }
      renderer.render(scene, camera);
    },
  };
}
