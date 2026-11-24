// Scoreboard, radar (the minimap), power and stamina bars, and pop-up messages.

import { HALF_L, HALF_W, GOAL_HALF, AREA_R, FREE_R, MAX_STEPS, STEP_LEN, HOLD_LIMIT } from '../sim/core.js';
import { clockText } from '../sim/match.js';

const $ = (id) => document.getElementById(id);

export function createHud(teams) {
  const el = {
    hud: $('hud'), scoreA: $('scoreA'), scoreB: $('scoreB'), clock: $('clock'), half: $('half'),
    banner: $('banner'), power: $('power'), powerFill: $('power').firstElementChild,
    stamina: $('stamina').firstElementChild, radar: $('radar'), note: $('note'),
    carry: $('carry'), pips: [...$('pips').children], hold: $('hold').firstElementChild, carryText: $('carryText'),
  };
  $('codeA').textContent = teams[0].code;
  $('codeB').textContent = teams[1].code;
  const g = el.radar.getContext('2d');
  const S = 6; // radar pixels per metre
  const OX = el.radar.width / 2;
  const OZ = el.radar.height / 2;
  const X = (x) => OX + x * S;
  const Z = (z) => OZ + z * S;
  let bannerTimer = 0;
  let last = {};

  function set(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  function areaLine(gx, r) {
    g.beginPath();
    if (gx > 0) {
      g.arc(X(gx), Z(-GOAL_HALF), r * S, -Math.PI / 2, Math.PI, true);
      g.arc(X(gx), Z(GOAL_HALF), r * S, Math.PI, Math.PI / 2, true);
    } else {
      g.arc(X(gx), Z(-GOAL_HALF), r * S, -Math.PI / 2, 0, false);
      g.arc(X(gx), Z(GOAL_HALF), r * S, 0, Math.PI / 2, false);
    }
  }

  function drawRadar(state) {
    const w = el.radar.width;
    const h = el.radar.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(8,22,38,0.78)';
    g.beginPath();
    g.roundRect(0, 0, w, h, 10);
    g.fill();
    g.save();
    g.beginPath();
    g.rect(X(-HALF_L), Z(-HALF_W), 2 * HALF_L * S, 2 * HALF_W * S);
    g.clip();
    g.fillStyle = 'rgba(42,130,194,0.55)';
    g.fillRect(0, 0, w, h);
    for (const gx of [-HALF_L, HALF_L]) {
      areaLine(gx, AREA_R);
      g.fillStyle = 'rgba(240,180,64,0.7)';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      areaLine(gx, FREE_R);
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.5;
    g.strokeRect(X(-HALF_L), Z(-HALF_W), 2 * HALF_L * S, 2 * HALF_W * S);
    g.beginPath();
    g.moveTo(X(0), Z(-HALF_W));
    g.lineTo(X(0), Z(HALF_W));
    g.stroke();

    for (const p of state.players) {
      g.beginPath();
      g.arc(X(p.x), Z(p.z), p.role === 'GK' ? 3 : 4, 0, Math.PI * 2);
      g.fillStyle = teams[p.team].radar;
      g.fill();
      if (p.id === state.ctrl) {
        g.strokeStyle = '#ffe14a';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(p.x), Z(p.z), 6.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    const b = state.ball;
    g.beginPath();
    g.arc(X(b.x), Z(b.z), 2.6, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
  }

  return {
    show(on) {
      el.hud.hidden = !on;
      last = {};
    },
    /** Big message across the middle of the screen for a moment. */
    banner(text, seconds = 1.6, tone = '') {
      el.banner.textContent = text;
      el.banner.className = 'on ' + tone;
      bannerTimer = seconds;
    },
    update(state, dt) {
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) el.banner.className = '';
      }
      if (!state) return;
      set(el.scoreA, 'a', String(state.score[0]));
      set(el.scoreB, 'b', String(state.score[1]));
      set(el.clock, 'c', clockText(state));
      set(el.half, 'h', state.phase === 'fulltime' ? 'FT' : state.half === 1 ? '1st' : '2nd');

      const charging = state.charge > 0;
      el.power.classList.toggle('on', charging);
      el.power.classList.toggle('big', charging && state.power);
      document.body.classList.toggle('slowmo', state.slow < 1);
      if (charging) {
        el.powerFill.style.width = Math.round(state.charge * 100) + '%';
        el.powerFill.classList.toggle('hot', state.charge > 0.93);
      }
      const me = state.ctrl != null ? state.players[state.ctrl] : null;
      el.stamina.style.width = (me ? Math.round(me.stam * 100) : 100) + '%';

      // Carrying rules for the player on the ball: steps left, seconds left, dribble.
      const carrying = !!me && me.hasBall && state.phase === 'play';
      el.carry.classList.toggle('on', carrying);
      let planted = false;
      if (carrying) {
        const left = me.dribbling ? MAX_STEPS : Math.max(0, MAX_STEPS - Math.floor(me.steps / STEP_LEN + 0.02));
        planted = left === 0;
        el.pips.forEach((pip, i) => pip.classList.toggle('on', i < left));
        const time = me.dribbling ? 1 : Math.max(0, 1 - me.holdT / HOLD_LIMIT);
        el.hold.style.width = Math.round(time * 100) + '%';
        el.hold.classList.toggle('low', time < 0.34);
        set(el.carryText, 'ct', me.dribbling ? 'Dribbling' : me.dribbled ? 'Dribble used' : 'Shift: dribble');
      }

      // Tell the player what the buttons do right now.
      let note = '';
      if (me && state.phase === 'play') {
        if (state.possTeam === state.humanTeam && state.possT > 30) note = 'Passive play warning: shoot soon!';
        else if (state.power) note = 'POWER SHOT: push towards a post to aim, let go to throw';
        else if (planted) note = 'Three steps used: pass (K) or shoot (Space)';
        else if (!me.hasBall && state.possTeam !== state.humanTeam) note = 'Defending: stand in the shooting lane, K or Space to steal, L to switch';
      }
      set(el.note, 'n', note);
      drawRadar(state);
    },
  };
}
