// Every texture in the game is painted here with the 2D canvas, so the project
// ships no image files at all.

import * as THREE from 'three';
import { HALF_L, HALF_W, GOAL_HALF, AREA_R, FREE_R } from '../sim/core.js';

export const COURT_MARGIN = 3; // metres of floor drawn outside the lines

function finish(canvas, repeatX = 0) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeatX) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = repeatX;
  }
  return tex;
}

/** Traces the edge of everything within `r` metres of the goal on x = gx. */
function areaPath(g, X, Z, PX, gx, r, close) {
  const R = r * PX;
  g.beginPath();
  if (gx > 0) {
    g.arc(X(gx), Z(-GOAL_HALF), R, -Math.PI / 2, Math.PI, true);
    g.lineTo(X(gx - r), Z(GOAL_HALF));
    g.arc(X(gx), Z(GOAL_HALF), R, Math.PI, Math.PI / 2, true);
  } else {
    g.arc(X(gx), Z(-GOAL_HALF), R, -Math.PI / 2, 0, false);
    g.lineTo(X(gx + r), Z(GOAL_HALF));
    g.arc(X(gx), Z(GOAL_HALF), R, 0, Math.PI / 2, false);
  }
  if (close) g.closePath();
}

/** The court floor with all its markings, to scale. */
export function makeCourtTexture() {
  const PX = 48;
  const M = COURT_MARGIN;
  const c = document.createElement('canvas');
  c.width = (2 * HALF_L + 2 * M) * PX;
  c.height = (2 * HALF_W + 2 * M) * PX;
  const g = c.getContext('2d');
  const X = (x) => (x + HALF_L + M) * PX;
  const Z = (z) => (z + HALF_W + M) * PX;
  const line = 0.09 * PX;

  g.fillStyle = '#12395a';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#2a82c2';
  g.fillRect(X(-HALF_L), Z(-HALF_W), 2 * HALF_L * PX, 2 * HALF_W * PX);
  // faint floorboard seams
  g.strokeStyle = 'rgba(255,255,255,0.045)';
  g.lineWidth = 1;
  for (let z = -HALF_W; z < HALF_W; z += 0.5) {
    g.beginPath();
    g.moveTo(X(-HALF_L), Z(z));
    g.lineTo(X(HALF_L), Z(z));
    g.stroke();
  }

  g.save();
  g.beginPath();
  g.rect(X(-HALF_L), Z(-HALF_W), 2 * HALF_L * PX, 2 * HALF_W * PX);
  g.clip();
  g.strokeStyle = '#ffffff';
  g.lineWidth = line;
  for (const gx of [-HALF_L, HALF_L]) {
    const inward = -Math.sign(gx);
    areaPath(g, X, Z, PX, gx, AREA_R, true);
    g.fillStyle = '#f0b440';
    g.fill();
    areaPath(g, X, Z, PX, gx, AREA_R, false);
    g.stroke();
    g.setLineDash([0.45 * PX, 0.45 * PX]);
    areaPath(g, X, Z, PX, gx, FREE_R, false);
    g.stroke();
    g.setLineDash([]);
    for (const [dist, half] of [[7, 0.5], [4, 0.12]]) {
      // 7 m penalty line and 4 m keeper line
      g.beginPath();
      g.moveTo(X(gx + inward * dist), Z(-half));
      g.lineTo(X(gx + inward * dist), Z(half));
      g.stroke();
    }
  }
  g.restore();

  g.strokeStyle = '#ffffff';
  g.lineWidth = line;
  g.strokeRect(X(-HALF_L), Z(-HALF_W), 2 * HALF_L * PX, 2 * HALF_W * PX);
  g.beginPath();
  g.moveTo(X(0), Z(-HALF_W));
  g.lineTo(X(0), Z(HALF_W));
  g.stroke();
  return finish(c);
}

/** A stand full of supporters in the two teams' colours. */
export function makeCrowdTexture(colors) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0c1826';
  g.fillRect(0, 0, 512, 256);
  const palette = [...colors, '#f1f1f1', '#e9c9a8', '#8b5a3c', '#2b2f3a', '#c9a27e'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 16; row++) {
    const y = 12 + row * 15;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, y + 7, 512, 2);
    for (let x = 4 + (row % 2) * 5; x < 512; x += 10) {
      if (rnd() < 0.12) continue; // an empty seat
      g.fillStyle = palette[Math.floor(rnd() * palette.length)];
      g.fillRect(x, y, 7, 8);
      g.fillStyle = ['#e9c9a8', '#c9a27e', '#8b5a3c'][Math.floor(rnd() * 3)];
      g.beginPath();
      g.arc(x + 3.5, y - 3, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  return finish(c, 5);
}

/** Pitch-side boards. */
export function makeBoardTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1b2c';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#f0b440';
  g.fillRect(0, 0, 1024, 4);
  g.fillRect(0, 60, 1024, 4);
  g.font = '700 34px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.fillText(text, 512, 34);
  return finish(c, 3);
}

export function makeNetTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
  }
  const tex = finish(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

/** Shirt number shown above a player's head. */
export function makeNumberTexture(num, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.font = '800 58px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(6,16,28,0.9)';
  g.strokeText(String(num), 48, 52);
  g.fillStyle = color;
  g.fillText(String(num), 48, 52);
  return finish(c);
}
