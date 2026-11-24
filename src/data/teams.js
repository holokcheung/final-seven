// The two finalists. This is the only file you need to edit to change kits,
// players or ratings.
//
// Names and shirt numbers are from each country's 2016 Olympic squad list on
// Wikipedia ("Handball at the 2016 Summer Olympics - Men's team rosters").
// One player was picked per position; this is NOT a record of who started the
// final. Faces and likenesses are not used: every player is drawn as the same
// plain figure. See "Names and branding" in the README.
//
// pos: GK keeper, LW/RW wings, LB/CB/RB backs, PV pivot.
// spd: running speed multiplier. sht: shooting accuracy from 0 to 1 (game values, made up).

export const TEAMS = [
  {
    code: 'DEN',
    name: 'Denmark',
    shirt: '#d3142f',
    shorts: '#ffffff',
    keeper: '#f2c230',
    radar: '#ff5468',
    players: [
      { num: 1, pos: 'GK', name: 'Niklas Landin Jacobsen', spd: 1.0, sht: 0.4 },
      { num: 6, pos: 'LW', name: 'Casper Ulrich Mortensen', spd: 1.06, sht: 0.76 },
      { num: 24, pos: 'LB', name: 'Mikkel Hansen', spd: 1.0, sht: 0.92 },
      { num: 5, pos: 'CB', name: 'Mads Mensah Larsen', spd: 1.02, sht: 0.8 },
      { num: 22, pos: 'RB', name: 'Kasper Søndergaard', spd: 1.0, sht: 0.82 },
      { num: 17, pos: 'RW', name: 'Lasse Svan Hansen', spd: 1.06, sht: 0.8 },
      { num: 23, pos: 'PV', name: 'Henrik Toft Hansen', spd: 0.96, sht: 0.76 },
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
      { num: 16, pos: 'GK', name: 'Thierry Omeyer', spd: 1.0, sht: 0.4 },
      { num: 21, pos: 'LW', name: 'Michaël Guigou', spd: 1.06, sht: 0.78 },
      { num: 8, pos: 'LB', name: 'Daniel Narcisse', spd: 1.0, sht: 0.86 },
      { num: 13, pos: 'CB', name: 'Nikola Karabatić', spd: 1.02, sht: 0.9 },
      { num: 28, pos: 'RB', name: 'Valentin Porte', spd: 1.0, sht: 0.84 },
      { num: 19, pos: 'RW', name: 'Luc Abalo', spd: 1.06, sht: 0.8 },
      { num: 20, pos: 'PV', name: 'Cédric Sorhaindo', spd: 0.96, sht: 0.78 },
    ],
  },
];

// How the real match ended, shown on the full-time screen.
export const REAL_FINAL = { score: [28, 26], date: '21 August 2016', place: 'Rio de Janeiro' };
