'use strict';

const { LudoGame, COLORS } = require('./LudoGame');

/**
 * Generate a short, human-friendly room code (no ambiguous chars).
 */
function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/**
 * In-memory store of rooms. A room is a lobby that becomes a game.
 *
 * room = {
 *   code, hostId, started,
 *   seats: [{ id, name, color, isBot, connected }],
 *   game: LudoGame | null,
 *   chat: [{ name, color, text, ts }],
 * }
 */
class GameManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(hostId, name) {
    let code;
    do {
      code = makeRoomCode();
    } while (this.rooms.has(code));

    const room = {
      code,
      hostId,
      started: false,
      seats: [],
      game: null,
      chat: [],
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    this._addSeat(room, { id: hostId, name, isBot: false });
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  _nextColor(room) {
    const taken = new Set(room.seats.map((s) => s.color));
    return COLORS.find((c) => !taken.has(c)) || null;
  }

  _addSeat(room, { id, name, isBot }) {
    const color = this._nextColor(room);
    if (!color) return null;
    const seat = {
      id,
      name: name || (isBot ? `Bot ${color}` : color),
      color,
      isBot: !!isBot,
      connected: true,
    };
    room.seats.push(seat);
    return seat;
  }

  joinRoom(code, playerId, name) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.started) return { error: 'Game already started.' };
    if (room.seats.length >= 4) return { error: 'Room is full.' };
    if (room.seats.some((s) => s.id === playerId)) {
      return { room, seat: room.seats.find((s) => s.id === playerId) };
    }
    const seat = this._addSeat(room, { id: playerId, name, isBot: false });
    if (!seat) return { error: 'Room is full.' };
    return { room, seat };
  }

  addBot(code, requesterId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.hostId !== requesterId) return { error: 'Only the host can add bots.' };
    if (room.started) return { error: 'Game already started.' };
    if (room.seats.length >= 4) return { error: 'Room is full.' };
    const seat = this._addSeat(room, { id: `bot-${Date.now()}`, name: null, isBot: true });
    return { room, seat };
  }

  removeSeat(code, seatId, requesterId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.hostId !== requesterId) return { error: 'Only the host can remove players.' };
    if (room.started) return { error: 'Game already started.' };
    room.seats = room.seats.filter((s) => s.id !== seatId);
    return { room };
  }

  startGame(code, requesterId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.hostId !== requesterId) return { error: 'Only the host can start the game.' };
    if (room.started) return { error: 'Game already started.' };
    if (room.seats.length < 2) return { error: 'Need at least 2 players to start.' };
    room.game = new LudoGame(room.seats);
    room.started = true;
    return { room };
  }

  /** Mark a player's seats disconnected; clean up empty rooms. */
  handleDisconnect(playerId) {
    const affected = [];
    for (const room of this.rooms.values()) {
      const seat = room.seats.find((s) => s.id === playerId);
      if (!seat) continue;

      if (room.started) {
        seat.connected = false;
        if (room.game) room.game.setConnected(seat.color, false);
        affected.push(room);
      } else {
        room.seats = room.seats.filter((s) => s.id !== playerId);
        // Reassign host if needed.
        if (room.hostId === playerId && room.seats.length) {
          const human = room.seats.find((s) => !s.isBot);
          room.hostId = human ? human.id : room.seats[0].id;
        }
        affected.push(room);
      }
    }
    this._gc();
    return affected;
  }

  reconnect(playerId, code) {
    const room = this.getRoom(code);
    if (!room) return null;
    const seat = room.seats.find((s) => s.id === playerId);
    if (!seat) return null;
    seat.connected = true;
    if (room.game) room.game.setConnected(seat.color, true);
    return room;
  }

  /** Drop rooms with no connected humans, or stale empties. */
  _gc() {
    for (const [code, room] of this.rooms) {
      const liveHumans = room.seats.some((s) => !s.isBot && s.connected);
      const stale = Date.now() - room.createdAt > 1000 * 60 * 60 * 6;
      if (!room.seats.length || (!liveHumans && (room.started || stale))) {
        this.rooms.delete(code);
      }
    }
  }

  publicRoom(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      started: room.started,
      seats: room.seats.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        isBot: s.isBot,
        connected: s.connected,
      })),
      game: room.game ? room.game.snapshot() : null,
    };
  }
}

module.exports = { GameManager, makeRoomCode };
