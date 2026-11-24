// Keyboard and touch input, merged into one answer for the simulation.
// Movement is returned in court coordinates, already rotated for the active
// camera, so "up" always means "away from the camera".
//
//   Keyboard                              Touch
//   W A S D / arrows  move                left thumb: a stick appears where you touch
//   K                 pass / steal        PASS
//   Space / J         shoot (hold)        SHOOT (hold)
//   Shift + Space     power shot          POWER (hold)
//   Shift             sprint / dribble    RUN (hold)
//   L                 switch player       SWITCH

const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
const GAME_KEYS = new Set([...Object.keys(MOVE), 'Space', 'KeyJ', 'KeyK', 'KeyL', 'ShiftLeft', 'ShiftRight']);
const STICK_RADIUS = 52; // pixels of thumb travel for full speed

/**
 * touch (optional): { zone, base, knob, buttons } elements for the on-screen controls.
 * Buttons are any elements with a data-touch="pass|shoot|power|run|switch" attribute.
 */
/** Keeps a press alive when the thumb slides off the control. Not every browser or pointer allows it. */
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // fine: the press still works, it just ends if the thumb leaves the control
  }
}

export function createInput(touch) {
  const down = new Set(); // keys and touch buttons held right now
  const pressed = new Set(); // those that went down since the last read
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
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

  function drawStick() {
    const live = stick.id != null;
    touch.base.classList.toggle('live', live);
    touch.base.style.left = live ? stick.ox + 'px' : '';
    touch.base.style.top = live ? stick.oy + 'px' : '';
    touch.knob.style.transform = `translate(${stick.x * STICK_RADIUS}px, ${stick.y * STICK_RADIUS}px)`;
  }

  function releaseStick() {
    stick.id = null;
    stick.x = stick.y = 0;
    drawStick();
  }

  if (touch) {
    // The stick is "floating": it centres itself wherever the left thumb lands.
    touch.zone.addEventListener('pointerdown', (e) => {
      if (stick.id != null) return;
      e.preventDefault();
      stick.id = e.pointerId;
      stick.ox = e.clientX;
      stick.oy = e.clientY;
      stick.x = stick.y = 0;
      capture(touch.zone, e.pointerId);
      drawStick();
    });
    touch.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stick.id) return;
      let dx = e.clientX - stick.ox;
      let dy = e.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        // Drag the base along so the thumb never runs out of travel.
        const k = STICK_RADIUS / d;
        stick.ox += dx * (1 - k);
        stick.oy += dy * (1 - k);
        dx *= k;
        dy *= k;
      }
      stick.x = dx / STICK_RADIUS;
      stick.y = dy / STICK_RADIUS;
      drawStick();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      touch.zone.addEventListener(type, (e) => {
        if (e.pointerId === stick.id) releaseStick();
      });
    }

    for (const el of touch.buttons) {
      const code = 'T:' + el.dataset.touch;
      const lift = () => {
        down.delete(code);
        el.classList.remove('held');
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!down.has(code)) pressed.add(code);
        down.add(code);
        el.classList.add('held');
        capture(el, e.pointerId);
        // A tick of feedback where the phone supports it (browsers only allow it after a first tap).
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, lift);
      el.addEventListener('contextmenu', (e) => e.preventDefault()); // no long-press menu
    }
  }

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
      ix = Math.sign(ix) + stick.x;
      iy = Math.sign(iy) - stick.y; // screen y grows downwards
      const mag = Math.hypot(ix, iy);
      if (mag > 1) {
        ix /= mag;
        iy /= mag;
      }
      // screen-right is (-fz, fx) for a camera looking along (fx, fz)
      out.mx = -forward.z * ix + forward.x * iy;
      out.mz = forward.x * ix + forward.z * iy;
      const power = down.has('T:power'); // one button standing in for Shift + Space
      out.sprint = down.has('ShiftLeft') || down.has('ShiftRight') || down.has('T:run') || power;
      out.shootHeld = down.has('Space') || down.has('KeyJ') || down.has('T:shoot') || power;
      out.passP = pressed.has('KeyK') || pressed.has('T:pass');
      out.shootP = pressed.has('Space') || pressed.has('KeyJ') || pressed.has('T:shoot') || pressed.has('T:power');
      out.switchP = pressed.has('KeyL') || pressed.has('T:switch');
      return out;
    },
    /** Call once the pressed keys have been handed to the simulation. */
    clearPressed() {
      pressed.clear();
    },
    reset() {
      down.clear();
      pressed.clear();
      if (touch) {
        releaseStick();
        for (const el of touch.buttons) el.classList.remove('held');
      }
    },
  };
}
