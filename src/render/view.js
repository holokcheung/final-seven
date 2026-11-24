// Everything you see in 3D: arena, goals, players, ball and cameras.
// The view only reads the match state; it never changes it.

import * as THREE from 'three';
import { HALF_L, HALF_W, GOAL_HALF, GOAL_H, clamp } from '../sim/core.js';
import { COURT_MARGIN, makeCourtTexture, makeCrowdTexture, makeBoardTexture, makeNetTexture } from './textures.js';
import { buildFigure, animateFigure, gripPosition } from './figure.js';

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

export function createView(canvas, teams) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Phones have dense screens and small GPUs: render a little softer there.
  const phone = window.matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
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
  sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 16, bottom: -16, near: 5, far: 70 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  buildArena(scene, teams);
  scene.add(buildGoal(-1), buildGoal(1));

  const figures = [];
  teams.forEach((team) => {
    for (const pl of team.players) {
      const f = buildFigure(team, pl);
      figures.push(f);
      scene.add(f.root);
    }
  });

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfff7e0, roughness: 0.45, emissive: 0x332a10 }));
  ball.castShadow = true;
  scene.add(ball);

  // Marker under the player you control, and a faint one under whoever your pass would go to.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const passRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  passRing.rotation.x = -Math.PI / 2;
  scene.add(passRing);

  const spinAxis = new THREE.Vector3();
  let closeUp = null; // { from: [x, y, z], at: [x, y, z] } pins the camera, for replays and checking animation
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
    if (closeUp) {
      camera.position.set(...closeUp.from);
      camera.lookAt(...closeUp.at);
      return;
    }
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
      camera.position.set(focus.x, 12.5, 21.5 + focus.z * 0.25);
      camera.lookAt(focus.x, 0.8, focus.z * 0.45 - 0.5);
    }
    forward.x = 0;
    forward.z = -1;
  }

  function poseBall(state, dt) {
    const b = state.ball;
    if (b.holder == null) {
      ball.position.set(b.x, Math.max(0.14, b.y), b.z);
      // Spin in flight, about the axis square to the way it is travelling.
      const v = Math.hypot(b.vx, b.vz);
      if (v > 0.5) ball.rotateOnWorldAxis(spinAxis.set(b.vz / v, 0, -b.vx / v), v * dt * 3);
      return;
    }
    const p = state.players[b.holder];
    if (p.dribbling) {
      // The one dribble: the ball bounces beside the runner, under the pumping hand.
      const y = 0.14 + Math.abs(Math.sin(state.time * 9)) * 0.8;
      ball.position.set(p.x + Math.cos(p.face) * 0.4 - Math.sin(p.face) * 0.32, y, p.z + Math.sin(p.face) * 0.4 + Math.cos(p.face) * 0.32);
    } else {
      // Otherwise it is in the throwing hand, wherever the arm has taken it.
      ball.position.copy(gripPosition(figures[p.id]));
    }
  }

  return {
    /** Ground direction that "up" on the keyboard should move you, for the current camera. */
    forward: () => forward,
    cameraName: () => CAMERAS[mode],
    /** Pin the camera somewhere (or pass null to hand it back to the normal cameras). */
    setCloseUp(shot) {
      closeUp = shot;
    },
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
      passRing.visible = playing && state.passTarget != null && state.phase === 'play';
      if (playing) {
        for (const p of state.players) animateFigure(figures[p.id], p, state, dt);
        poseBall(state, dt);
        if (state.ctrl != null) {
          const p = state.players[state.ctrl];
          ring.position.set(p.x, 0.04, p.z);
          ring.scale.setScalar(1 + Math.sin(state.time * 6) * 0.06);
        }
        if (passRing.visible) {
          const t = state.players[state.passTarget];
          passRing.position.set(t.x, 0.04, t.z);
        }
      }
      renderer.render(scene, camera);
    },
  };
}
