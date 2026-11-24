// The two finalists. This is the only file you need to edit to change kits,
// shirt numbers or ratings.
//
// Players are shirt numbers and positions only. Real athletes' names are left
// out on purpose (see "Names and branding" in the README) - add a `name` field
// per player if you want one shown.
//
// pos: GK keeper, LW/RW wings, LB/CB/RB backs, PV pivot.
// spd: running speed multiplier. sht: shooting accuracy from 0 to 1.

export const TEAMS = [
  {
    code: 'DEN',
    name: 'Denmark',
    shirt: '#d3142f',
    shorts: '#ffffff',
    keeper: '#f2c230',
    radar: '#ff5468',
    players: [
      { num: 1, pos: 'GK', spd: 1.0, sht: 0.4 },
      { num: 7, pos: 'LW', spd: 1.06, sht: 0.74 },
      { num: 24, pos: 'LB', spd: 1.0, sht: 0.92 },
      { num: 4, pos: 'CB', spd: 1.02, sht: 0.8 },
      { num: 11, pos: 'RB', spd: 1.0, sht: 0.82 },
      { num: 19, pos: 'RW', spd: 1.06, sht: 0.8 },
      { num: 22, pos: 'PV', spd: 0.96, sht: 0.76 },
    ],
  },
  {
    code: 'FRA',
    name: 'France',
    shirt: '#1d3f9c',
    shorts: '#ffffff',
    keeper: '#1e1e24',
    radar: '#5b8cff',
    players: [
      { num: 16, pos: 'GK', spd: 1.0, sht: 0.4 },
      { num: 21, pos: 'LW', spd: 1.06, sht: 0.78 },
      { num: 13, pos: 'LB', spd: 1.0, sht: 0.9 },
      { num: 5, pos: 'CB', spd: 1.02, sht: 0.8 },
      { num: 8, pos: 'RB', spd: 1.0, sht: 0.84 },
      { num: 19, pos: 'RW', spd: 1.06, sht: 0.78 },
      { num: 2, pos: 'PV', spd: 0.96, sht: 0.78 },
    ],
  },
];

// How the real match ended, shown on the full-time screen.
export const REAL_FINAL = { score: [28, 26], date: '21 August 2016', place: 'Rio de Janeiro' };
