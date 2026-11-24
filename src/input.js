// Keyboard input. Movement is returned in court coordinates, already rotated
// for the active camera, so "up" always means "away from the camera".
//
//   W A S D / arrows  move        K            pass (steal when defending)
//   Shift             sprint      Space / J    shoot: hold to charge, release
//   L                 switch player

const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
const GAME_KEYS = new Set([...Object.keys(MOVE), 'Space', 'KeyJ', 'KeyK', 'KeyL', 'ShiftLeft', 'ShiftRight']);

export function createInput() {
  const down = new Set();
  const pressed = new Set(); // keys that went down since the last read
  const out = { mx: 0, mz: 0, sprint: false, passP: false, shootHeld: false, shootP: false, switchP: false };

  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      down.add(e.code);
      pressed.add(e.code);
    }
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());

  return {
    /** forward: the ground direction the camera is looking along. */
    read(forward) {
      let ix = 0;
      let iy = 0;
      for (const code of down) {
        const m = MOVE[code];
        if (m) {
          ix += m[0];
          iy += m[1];
        }
      }
      ix = Math.sign(ix);
      iy = Math.sign(iy);
      // screen-right is (-fz, fx) for a camera looking along (fx, fz)
      out.mx = -forward.z * ix + forward.x * iy;
      out.mz = forward.x * ix + forward.z * iy;
      out.sprint = down.has('ShiftLeft') || down.has('ShiftRight');
      out.shootHeld = down.has('Space') || down.has('KeyJ');
      out.passP = pressed.has('KeyK');
      out.shootP = pressed.has('Space') || pressed.has('KeyJ');
      out.switchP = pressed.has('KeyL');
      return out;
    },
    /** Call once the pressed keys have been handed to the simulation. */
    clearPressed() {
      pressed.clear();
    },
    reset() {
      down.clear();
      pressed.clear();
    },
  };
}
