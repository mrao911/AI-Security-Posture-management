/* Board geometry for rendering. Mirrors the server's abstract model so the
 * drawn board lines up exactly with the rules engine. Grid is 15x15.
 * Coordinates are [col, row] with the origin at the top-left. */

const GRID = 15;

// 52-cell shared ring, clockwise, index 0 == red's start cell.
const PATH = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
];

const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };

const SAFE_INDICES = [0, 8, 13, 21, 26, 34, 39, 47];

// Home lanes (6 cells each), outer -> inner (progress 51..56).
const HOME_LANES = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
};

// Token parking spots in each yard (the 4 circles inside the home base).
const YARD_SPOTS = {
  red: [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],
  green: [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
  yellow: [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
  blue: [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
};

// 6x6 yard rectangles [col, row, w, h].
const YARDS = {
  red: [0, 0, 6, 6],
  green: [9, 0, 6, 6],
  yellow: [9, 9, 6, 6],
  blue: [0, 9, 6, 6],
};

const COLOR_HEX = {
  red: '#e53935',
  green: '#43a047',
  yellow: '#fbc02d',
  blue: '#1e88e5',
};

const COLOR_DARK = {
  red: '#b71c1c',
  green: '#1b5e20',
  yellow: '#f57f17',
  blue: '#0d47a1',
};

/** Pixel-space helpers given a cell size. */
function cellCenter(col, row, cell) {
  return { x: col * cell + cell / 2, y: row * cell + cell / 2 };
}

/** Where a token is drawn, given its server-side state. progress 0..56. */
function tokenCell(color, token) {
  if (token.state === 'yard') return null; // drawn from YARD_SPOTS instead
  if (token.progress <= 50) {
    return PATH[(START_INDEX[color] + token.progress) % 52];
  }
  // home lane
  return HOME_LANES[color][token.progress - 51];
}

if (typeof window !== 'undefined') {
  window.LUDO = {
    GRID, PATH, START_INDEX, SAFE_INDICES, HOME_LANES, YARD_SPOTS, YARDS,
    COLOR_HEX, COLOR_DARK, cellCenter, tokenCell,
  };
}
