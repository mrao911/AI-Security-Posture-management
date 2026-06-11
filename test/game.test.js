'use strict';

/* Lightweight assertion tests for the Ludo rules engine (no framework). */

const assert = require('assert');
const { LudoGame, START_INDEX, SAFE_INDICES } = require('../server/LudoGame');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error('    ', err.message);
    process.exitCode = 1;
  }
}

function newGame(colors = ['red', 'green']) {
  return new LudoGame(colors.map((c, i) => ({ id: `p${i}`, name: c, color: c })));
}

console.log('LudoGame rules');

test('starts with all tokens in the yard', () => {
  const g = newGame();
  for (const p of g.players) {
    assert.strictEqual(p.tokens.length, 4);
    assert.ok(p.tokens.every((t) => t.state === 'yard'));
  }
  assert.strictEqual(g.currentColor, 'red');
});

test('cannot leave the yard without a six', () => {
  const g = newGame();
  const roll = g.rollDice(3);
  assert.ok(roll.noMoves, 'rolling 3 with all tokens home should give no moves');
  assert.strictEqual(g.currentColor, 'green', 'turn should pass');
});

test('a six lets a token leave the yard and grants an extra turn', () => {
  const g = newGame();
  g.rollDice(6);
  assert.deepStrictEqual(g.movableTokens, [0, 1, 2, 3]);
  const res = g.moveToken('red', 0);
  assert.ok(res.ok && res.extraTurn, 'six grants another turn');
  assert.strictEqual(g.currentColor, 'red');
  const token = g.player('red').tokens[0];
  assert.strictEqual(token.state, 'active');
  assert.strictEqual(token.progress, 0);
  assert.strictEqual(token.ringIndex ?? g.ringIndex(g.player('red'), token), START_INDEX.red);
});

test('three consecutive sixes burn the turn', () => {
  const g = newGame();
  g.rollDice(6); g.moveToken('red', 0); // six -> extra turn, still red
  g.rollDice(6); g.moveToken('red', 1); // six -> extra turn, still red
  const res = g.rollDice(6); // third six
  assert.ok(res.burned, 'third six should burn the turn');
  assert.strictEqual(g.currentColor, 'green');
});

test('normal roll advances and passes the turn', () => {
  const g = newGame();
  g.rollDice(6); g.moveToken('red', 0); // out, extra turn
  g.rollDice(4); // move token 0 by 4
  const res = g.moveToken('red', 0);
  assert.ok(res.ok && !res.extraTurn);
  assert.strictEqual(g.player('red').tokens[0].progress, 4);
  assert.strictEqual(g.currentColor, 'green', 'turn passes after a non-six');
});

test('captures send an opponent back to the yard', () => {
  const g = newGame(['red', 'green']);
  // Place a green token on an unsafe ring cell that red can land on.
  const green = g.player('green');
  // Red start is ring index 0. Red at progress 1 lands on ring index 1.
  // Put green on ring index 1: green progress = (1 - START_INDEX.green + 52) % 52
  const target = 1;
  assert.ok(!SAFE_INDICES.has(target));
  green.tokens[0].state = 'active';
  green.tokens[0].progress = (target - START_INDEX.green + 52) % 52;
  // Get red out and onto progress 1.
  g.rollDice(6); g.moveToken('red', 0); // red token0 at progress 0 (ring 0)
  g.rollDice(1);
  const res = g.moveToken('red', 0); // red -> ring index 1, captures green
  assert.ok(res.ok);
  assert.strictEqual(green.tokens[0].state, 'yard', 'green token captured');
  assert.ok(res.extraTurn, 'capture grants an extra turn');
});

test('no capture on a safe square', () => {
  const g = newGame(['red', 'green']);
  const green = g.player('green');
  const safe = 8; // a star safe cell, reachable by red at progress 8
  assert.ok(SAFE_INDICES.has(safe));
  green.tokens[0].state = 'active';
  green.tokens[0].progress = (safe - START_INDEX.green + 52) % 52;
  // Move red onto progress 8 in two hops (6 then 2).
  g.rollDice(6); g.moveToken('red', 0); // ring 0
  g.rollDice(6); g.moveToken('red', 0); // ring 6 (six -> extra turn)
  g.rollDice(2); g.moveToken('red', 0); // ring 8 (safe)
  assert.strictEqual(green.tokens[0].state, 'active', 'green is safe on a star cell');
});

test('reaching home requires an exact roll and finishing wins', () => {
  const g = newGame(['red', 'green']);
  const red = g.player('red');
  // Park three red tokens at home, one near the end.
  red.tokens[0].state = 'home'; red.tokens[0].progress = 56;
  red.tokens[1].state = 'home'; red.tokens[1].progress = 56;
  red.tokens[2].state = 'home'; red.tokens[2].progress = 56;
  red.tokens[3].state = 'active'; red.tokens[3].progress = 54; // needs exactly 2

  // Overshoot is illegal.
  const over = g.rollDice(5);
  assert.ok(over.noMoves, 'cannot overshoot home');
  // Back to red after the pass; set up again.
  g.turnPointer = g.order.indexOf('red');
  const exact = g.rollDice(2);
  assert.deepStrictEqual(exact.movable, [3]);
  const res = g.moveToken('red', 3);
  assert.ok(res.gameOver, 'finishing all tokens ends the game');
  assert.strictEqual(g.winner, 'red');
});

test('snapshot exposes ring indices for active tokens', () => {
  const g = newGame();
  g.rollDice(6); g.moveToken('red', 0);
  const snap = g.snapshot();
  const redSnap = snap.players.find((p) => p.color === 'red');
  assert.strictEqual(redSnap.tokens[0].ringIndex, START_INDEX.red);
  assert.strictEqual(redSnap.tokens[1].ringIndex, null);
});

console.log(`\n${passed} checks passed.`);
