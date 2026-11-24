// Entry point: wires the menu, the game loop, input, HUD and sound together.
//
// Handy URLs while developing:
//   ?quick   skip the menu and play as Denmark
//   ?demo    computer vs computer (also what the test script runs)
//   ?debug   expose window.__game for poking at the match state

import './style.css';
import { createMatch, step, NO_INPUT } from './sim/match.js';
import { STEP } from './sim/core.js';
import { TEAMS, REAL_FINAL } from './data/teams.js';
import { createView } from './render/view.js';
import { createHud } from './ui/hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LENGTHS = { quick: 120, standard: 300, full: 600 }; // real seconds per half

const view = createView($('game'), TEAMS);
const hud = createHud(TEAMS);
const input = createInput({
  zone: $('stickZone'),
  base: $('stickBase'),
  knob: $('stickKnob'),
  buttons: [...document.querySelectorAll('[data-touch]')],
});
const audio = createAudio();

const choice = { team: 0, diff: 1, len: 'standard' };
const held = { ...NO_INPUT }; // the same input with one-shot presses removed, for extra sub-steps
let state = null;
let paused = false;
let acc = 0;
let speed = 1; // 1 is real time; the power shot eases this down for slow motion
let last = performance.now();

function startMatch(humanTeam = choice.team) {
  state = createMatch({
    teams: TEAMS,
    seed: (Math.random() * 2 ** 31) | 0,
    humanTeam,
    difficulty: choice.diff,
    halfSeconds: LENGTHS[choice.len],
  });
  acc = 0;
  speed = 1;
  paused = false;
  input.reset();
  for (const id of ['menu', 'pause', 'end']) $(id).hidden = true;
  hud.show(true);
  audio.start();
  hud.banner(`${TEAMS[0].name} v ${TEAMS[1].name}`, 1.4);
  if (params.has('debug')) window.__game = { state, view, hud, input, step };
}

function showMenu() {
  state = null;
  hud.show(false);
  for (const id of ['pause', 'end']) $(id).hidden = true;
  $('menu').hidden = false;
}

function setPaused(on) {
  if (!state || state.phase === 'fulltime') return;
  paused = on;
  $('pause').hidden = !on;
  input.reset();
}

function showFullTime() {
  const [a, b] = state.score;
  const H = state.humanTeam;
  let verdict = 'Full time';
  if (H != null) verdict = a === b ? 'Draw' : (a > b) === (H === 0) ? 'You win the final!' : 'Beaten in the final';
  $('endTitle').textContent = verdict;
  $('endScore').textContent = `${TEAMS[0].name} ${a} – ${b} ${TEAMS[1].name}`;
  $('endReal').textContent = `The real final, ${REAL_FINAL.date} in ${REAL_FINAL.place}: ${TEAMS[0].name} ${REAL_FINAL.score[0]} – ${REAL_FINAL.score[1]} ${TEAMS[1].name}.`;
  const st = state.stats;
  $('endStats').innerHTML = [['Passes', st.passes], ['Shots', st.shots], ['Saves', st.saves], ['Blocks', st.blocks], ['Steals', st.steals]]
    .map(([label, v]) => `<tr><td>${v[0]}</td><th>${label}</th><td>${v[1]}</td></tr>`)
    .join('');
  $('end').hidden = false;
}

function onEvent(e) {
  switch (e.type) {
    case 'whistle': audio.whistle(); break;
    case 'pass': audio.throwBall(); break;
    case 'shot': if (e.power) audio.powerShot(); else audio.throwBall(); break;
    case 'catch': audio.catchBall(); break;
    case 'bounce': audio.bounce(); break;
    case 'post': audio.post(); audio.gasp(); hud.banner('Off the woodwork!', 1.1); break;
    case 'save': audio.catchBall(); audio.gasp(); hud.banner('Saved!', 1); break;
    case 'block': audio.catchBall(); hud.banner('Blocked!', 0.9); break;
    case 'steal': hud.banner(e.team === state.humanTeam ? 'Stolen!' : 'Ball lost!', 0.9); break;
    case 'passive': hud.banner('Passive play', 1.3); break;
    case 'held': hud.banner('Three seconds!', 1.3); break;
    case 'goal': audio.goal(); audio.whistle(); hud.banner(`GOAL!  ${e.scorer >= 0 ? state.players[e.scorer].name : TEAMS[e.team].name}`, 2.3, 'goal'); break;
    case 'halftime': audio.whistle(2); hud.banner('Half-time – change ends', 2.6); break;
    case 'fulltime': audio.whistle(3); showFullTime(); break;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state && !paused) {
    speed += (state.slow - speed) * Math.min(1, dt * 12);
    acc += dt * speed;
    const inp = input.read(view.forward());
    Object.assign(held, inp, { passP: false, shootP: false, switchP: false });
    let first = true;
    while (acc >= STEP) {
      step(state, STEP, first ? inp : held);
      first = false;
      acc -= STEP;
    }
    if (speed < 0.95 && acc > 0.001) {
      // Slow motion: take the left-over fraction as a small step so movement stays smooth.
      step(state, acc, first ? inp : held);
      first = false;
      acc = 0;
    }
    if (!first) {
      input.clearPressed();
      for (const e of state.events) onEvent(e);
      if (state) state.events.length = 0;
    }
  }
  view.render(state, paused ? 0 : dt * speed);
  hud.update(state, dt);
}

// ---- menu wiring: each group of buttons sets one option ----
for (const group of document.querySelectorAll('[data-option]')) {
  const key = group.dataset.option;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of group.querySelectorAll('button')) b.classList.toggle('on', b === btn);
    choice[key] = key === 'len' ? btn.value : Number(btn.value);
  });
}
$('start').addEventListener('click', () => startMatch());
$('resume').addEventListener('click', () => setPaused(false));
$('quit').addEventListener('click', showMenu);
$('again').addEventListener('click', () => startMatch());
$('toMenu').addEventListener('click', showMenu);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') setPaused(!paused);
  else if (e.code === 'KeyC' && state) hud.banner(`Camera: ${view.nextCamera()}`, 0.9);
  else if (e.code === 'KeyM') hud.banner(audio.toggleMute() ? 'Sound off' : 'Sound on', 0.9);
  else if (e.code === 'Enter' && !$('menu').hidden) startMatch();
});
$('tPause').addEventListener('click', () => setPaused(true));
$('tCam').addEventListener('click', () => state && hud.banner(`Camera: ${view.nextCamera()}`, 0.9));

// Touch devices get the on-screen stick and buttons: phones and tablets straight
// away, anything else the first time its screen is actually touched. ?touch forces it.
const useTouch = () => document.body.classList.add('touch');
if (params.has('touch') || window.matchMedia('(hover: none) and (pointer: coarse)').matches) useTouch();
window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && useTouch(), { passive: true });
// The match waits while a phone is held upright (the "turn your phone" notice is showing).
const upright = window.matchMedia('(orientation: portrait) and (max-width: 600px)');
upright.addEventListener('change', () => upright.matches && document.body.classList.contains('touch') && setPaused(true));

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !params.has('debug')) setPaused(true);
});

if (params.has('demo')) startMatch(null);
else if (params.has('quick')) startMatch(0);
requestAnimationFrame(frame);
