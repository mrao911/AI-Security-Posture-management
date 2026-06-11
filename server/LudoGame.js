'use strict';

/**
 * LudoGame — server-authoritative Ludo rules engine.
 *
 * Board model (abstract, no pixels):
 *   - 52-cell shared main ring, indices 0..51 (clockwise).
 *   - Each colour enters the ring at a fixed START_INDEX, 13 apart.
 *   - A token's progress `p` runs 0..56:
 *        p in [0..50]  -> on the main ring at (START_INDEX[colour] + p) % 52
 *        p in [51..56] -> in the colour's 6-cell home lane (p - 51 = lane cell)
 *        p === 56      -> finished (innermost / home)
 *   - Tokens in the yard have progress null / state 'yard'.
 *
 * Pixel geometry lives only on the client (public/js/constants.js); the two
 * share the same numbers (START_INDEX, SAFE_INDICES) so the board lines up.
 */

const COLORS = ['red', 'green', 'yellow', 'blue'];

const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };

// Safe squares (no captures here): the four start cells + four "star" cells.
const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const MAIN_LAST = 50; // last main-ring progress value (steps 0..50 == 51 cells)
const HOME_PROGRESS = 56; // finished

class LudoGame {
  /**
   * @param {Array<{id:string,name:string,color:string,isBot?:boolean}>} seats
   */
  constructor(seats) {
    this.players = seats.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      isBot: !!s.isBot,
      connected: true,
      finished: false,
      tokens: [0, 1, 2, 3].map((t) => ({
        index: t,
        state: 'yard', // 'yard' | 'active' | 'home'
        progress: null, // 0..56 when active/home
      })),
    }));

    this.order = this.players.map((p) => p.color);
    this.turnPointer = 0;
    this.dice = null;
    this.dicePending = false; // a value has been rolled and awaits a move
    this.consecutiveSixes = 0;
    this.movableTokens = []; // token indices the current player may move
    this.winner = null;
    this.ranking = []; // colours in the order they finished
    this.lastEvent = null; // { type, ... } describing the latest action
    this.started = true;
  }

  get currentColor() {
    return this.order[this.turnPointer];
  }

  player(color) {
    return this.players.find((p) => p.color === color);
  }

  /** Absolute ring index for an active token, or null. */
  ringIndex(player, token) {
    if (token.state !== 'active' || token.progress > MAIN_LAST) return null;
    return (START_INDEX[player.color] + token.progress) % 52;
  }

  // --------------------------------------------------------------------- dice
  /**
   * Roll the dice for the current player.
   * @param {number} [forced] optional forced value (testing / deterministic).
   */
  rollDice(forced) {
    if (this.winner) return { ok: false, reason: 'game-over' };
    if (this.dicePending) return { ok: false, reason: 'already-rolled' };

    const value = forced || 1 + Math.floor(Math.random() * 6);
    this.dice = value;

    if (value === 6) {
      this.consecutiveSixes += 1;
    } else {
      this.consecutiveSixes = 0;
    }

    // Three 6s in a row burns the turn.
    if (this.consecutiveSixes === 3) {
      this.lastEvent = { type: 'three-sixes', color: this.currentColor };
      this.dice = null;
      this.consecutiveSixes = 0;
      this.movableTokens = [];
      this._advanceTurn();
      return { ok: true, value, burned: true };
    }

    this.movableTokens = this._legalMoves(this.currentColor, value);
    this.dicePending = true;

    if (this.movableTokens.length === 0) {
      // No legal move — turn passes (a 6 still does not help if blocked).
      this.lastEvent = { type: 'no-move', color: this.currentColor, value };
      this.dice = null;
      this.dicePending = false;
      this._advanceTurn();
      return { ok: true, value, noMoves: true };
    }

    return { ok: true, value, movable: this.movableTokens.slice() };
  }

  /** Indices of tokens the player can legally move with `value`. */
  _legalMoves(color, value) {
    const player = this.player(color);
    const moves = [];
    for (const token of player.tokens) {
      if (token.state === 'home') continue;
      if (token.state === 'yard') {
        if (value === 6) moves.push(token.index);
        continue;
      }
      // active
      if (token.progress + value <= HOME_PROGRESS) moves.push(token.index);
    }
    return moves;
  }

  // --------------------------------------------------------------------- move
  /**
   * Move a token chosen by the current player.
   * @returns {{ok:boolean, reason?:string}}
   */
  moveToken(color, tokenIndex) {
    if (this.winner) return { ok: false, reason: 'game-over' };
    if (color !== this.currentColor) return { ok: false, reason: 'not-your-turn' };
    if (!this.dicePending) return { ok: false, reason: 'roll-first' };
    if (!this.movableTokens.includes(tokenIndex)) {
      return { ok: false, reason: 'illegal-move' };
    }

    const player = this.player(color);
    const token = player.tokens[tokenIndex];
    const value = this.dice;

    let captured = [];
    let reachedHome = false;

    if (token.state === 'yard') {
      token.state = 'active';
      token.progress = 0; // onto the start cell
    } else {
      token.progress += value;
      if (token.progress === HOME_PROGRESS) {
        token.state = 'home';
        reachedHome = true;
      }
    }

    // Capture check (only on the shared ring, not on safe squares).
    const landing = this.ringIndex(player, token);
    if (landing !== null && !SAFE_INDICES.has(landing)) {
      captured = this._captureAt(color, landing);
    }

    // Win check for this player.
    if (player.tokens.every((t) => t.state === 'home')) {
      player.finished = true;
      if (!this.ranking.includes(color)) this.ranking.push(color);
    }

    this.lastEvent = {
      type: 'move',
      color,
      token: tokenIndex,
      captured: captured.map((c) => ({ color: c.color, token: c.token })),
      reachedHome,
    };

    // Reset dice state for this roll.
    this.dice = null;
    this.dicePending = false;
    this.movableTokens = [];

    // Determine end-of-game / extra turn.
    const activeFinishers = this.players.filter((p) => !p.finished);
    if (activeFinishers.length <= 1) {
      // Everyone but (at most) one player is home: game over.
      for (const p of activeFinishers) {
        if (!this.ranking.includes(p.color)) this.ranking.push(p.color);
      }
      this.winner = this.ranking[0];
      return { ok: true, gameOver: true };
    }

    const extraTurn = value === 6 || captured.length > 0 || reachedHome;
    if (!extraTurn) {
      this.consecutiveSixes = 0;
      this._advanceTurn();
    } else if (value !== 6) {
      // Bonus from capture/home but not a six -> streak resets.
      this.consecutiveSixes = 0;
    }

    return { ok: true, extraTurn };
  }

  /** Send every opposing token on `index` back to its yard. */
  _captureAt(byColor, index) {
    const captured = [];
    for (const p of this.players) {
      if (p.color === byColor) continue;
      for (const token of p.tokens) {
        if (token.state === 'active' && this.ringIndex(p, token) === index) {
          token.state = 'yard';
          token.progress = null;
          captured.push({ color: p.color, token: token.index });
        }
      }
    }
    return captured;
  }

  // --------------------------------------------------------------------- turn
  _advanceTurn() {
    this.consecutiveSixes = 0;
    let guard = 0;
    do {
      this.turnPointer = (this.turnPointer + 1) % this.order.length;
      guard += 1;
    } while (this.player(this.currentColor).finished && guard <= this.order.length);
  }

  // ------------------------------------------------------------ disconnection
  setConnected(color, connected) {
    const p = this.player(color);
    if (p) p.connected = connected;
  }

  // --------------------------------------------------------------- bot helper
  /**
   * Pick a token for a bot to move from the current movable set.
   * Heuristic: prefer captures, then getting a token home, then leaving the
   * yard, then advancing the most progressed token.
   */
  botChooseToken() {
    const color = this.currentColor;
    const player = this.player(color);
    const value = this.dice;
    let best = this.movableTokens[0];
    let bestScore = -Infinity;

    for (const idx of this.movableTokens) {
      const token = player.tokens[idx];
      let score = 0;

      if (token.state === 'yard') {
        score = 50; // getting out is good
      } else {
        const newProgress = token.progress + value;
        if (newProgress === HOME_PROGRESS) score = 100; // home!
        else if (newProgress > MAIN_LAST) score = 70; // entering home lane
        else {
          const landing = (START_INDEX[color] + newProgress) % 52;
          if (!SAFE_INDICES.has(landing) && this._wouldCapture(color, landing)) {
            score = 90; // capture
          } else {
            score = 10 + newProgress / 10; // generally advance furthest
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    }
    return best;
  }

  _wouldCapture(byColor, index) {
    for (const p of this.players) {
      if (p.color === byColor) continue;
      for (const token of p.tokens) {
        if (token.state === 'active' && this.ringIndex(p, token) === index) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------ serialisable state
  snapshot() {
    return {
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        connected: p.connected,
        finished: p.finished,
        tokens: p.tokens.map((t) => ({
          index: t.index,
          state: t.state,
          progress: t.progress,
          ringIndex: this.ringIndex(p, t),
        })),
      })),
      order: this.order,
      currentColor: this.currentColor,
      dice: this.dice,
      dicePending: this.dicePending,
      movableTokens: this.movableTokens.slice(),
      winner: this.winner,
      ranking: this.ranking.slice(),
      lastEvent: this.lastEvent,
    };
  }
}

module.exports = { LudoGame, COLORS, START_INDEX, SAFE_INDICES };
