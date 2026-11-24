# Final Seven

A 3D handball game you play in the browser. One match: **Denmark v France, the 2016 men's final**. Pick a side and see if you can change the result (the real one finished Denmark 28 – 26 France).

**[▶ Play it now: holokcheung.com/final-seven](https://holokcheung.com/final-seven/)** — nothing to install. It needs a keyboard for now; touch controls are next on the roadmap.

Built with [Three.js](https://threejs.org) and [Vite](https://vite.dev). No image or sound files: the court, the crowd and every sound are generated in code.

## Run it

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open the address it prints (normally `http://localhost:5173`).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the game locally with live reload |
| `npm test` | Play 20 computer-v-computer matches and check the rules hold |
| `npm run build` | Build the static site into `dist/` |

Add `?quick` to the address to skip the menu, or `?demo` to watch the computer play itself.

## Controls

| Key | With the ball | Without the ball |
| --- | --- | --- |
| `W` `A` `S` `D` / arrows | Move (three steps) | Move |
| `K` | Pass towards the direction you are pushing | Try to steal |
| `Space` or `J` | Hold to charge a shot, release to throw. Push towards a post to aim | Try to steal |
| `Shift` + `Space` | **Power shot**: slow motion while you aim, then a much harder throw for long range. Costs stamina | |
| `Shift` | Dribble (once per catch) | Sprint |
| `L` | | Switch to the defender nearest the ball |
| `C` / `M` / `P` | Change camera / mute / pause | |

The radar at the bottom shows all fourteen players. The ring is you.

## The handball in it

- **Three steps, three seconds.** With the ball in your hand you can take three steps and hold it for three seconds. After the third step your feet are planted. Hold it too long and the other team gets a free throw.
- **One dribble.** `Shift` bounces the ball so you can run. You get one per catch; picking the ball up again gives three fresh steps. A bouncing ball is easy to steal, so it is for open court, not for breaking down a set defence.
- **Pass to move it.** Attacks are built by moving the ball round the back court (wing, back, centre, back, wing) until a shooting lane opens. The computer plays the same way, about six passes for every shot.
- **The goal area.** Only the goalkeeper may stand inside the 6 m line.
- **Defending is positioning.** A defender standing in the shooting lane gets a chance to block. The computer defends 6-0, with the nearest player stepping out to the ball.
- **Passive play.** A team that keeps the ball too long without shooting loses it.
- **Two halves, change of ends**, throw-off after every goal, throw-ins and goalkeeper throws.

Not in yet: fouls and free throws for contact, 7 m penalties, suspensions, corner throws, substitutions, extra time.

## How the code is laid out

```
src/
  sim/        the match itself. No DOM, no Three.js, so it runs in Node for tests
    core.js     court size, rule constants, small maths helpers
    match.js    state, rules, ball physics, player control
    ai.js       team shape and what a computer-controlled ball carrier does
  render/     the 3D view: arena, players, ball, cameras, canvas-painted textures
  ui/hud.js   scoreboard, radar, step and time indicators
  data/teams.js   kits, shirt numbers, ratings
  input.js    keyboard
  audio.js    synthesised crowd, whistle and ball sounds
  main.js     menu and game loop
scripts/simtest.mjs   headless rule check, run by `npm test`
```

The simulation runs at 120 steps a second and is seeded, so a test match plays out the same way every time. To change how the game plays, the numbers at the top of `src/sim/match.js` (speeds, keeper reach, block chance, power shot cost) are the place to start; run `npm test` afterwards to see what it did to scoring.

## Names and branding

The teams are the two countries that played the final, with their colours. Players are **shirt numbers and positions only**. Real athletes' names and likenesses, and the Olympic rings and logos, are deliberately not used: they belong to other people, and a public game needs permission to use them. If you want names on your own copy, add a `name` to each player in `src/data/teams.js`.

## Roadmap

1. **Now:** one full match, both teams playable, three difficulties, three cameras.
2. Touch controls (virtual stick and buttons) and gamepad support.
3. Fouls, free throws at the 9 m line, 7 m penalties and two-minute suspensions.
4. Shot types: bounce shot, lob, spin shot from the wing; a diving goalkeeper.
5. Smarter attack: crossing runs, pivot screens, fast breaks; 5-1 and 3-2-1 defences.
6. Extra time and a penalty shoot-out when the final is level.
7. Player models and animation in place of the block figures.

## Credits

Written from scratch. Ideas on structure came from reading open-source browser sports games on GitHub: keeping the simulation separate from rendering so it can be tested, a single data file for teams, sound generated in code, and Mat Buckland's "Simple Soccer" approach to team AI. No code or assets were copied from them.
