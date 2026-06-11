'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { GameManager } = require('./GameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const manager = new GameManager();

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));

// ---------------------------------------------------------------- broadcasting
function broadcastRoom(room) {
  if (!room) return;
  io.to(room.code).emit('room:update', manager.publicRoom(room));
}

function systemChat(room, text) {
  const entry = { name: 'system', color: 'system', text, ts: Date.now() };
  room.chat.push(entry);
  io.to(room.code).emit('chat:message', entry);
}

// --------------------------------------------------------------------- bots
// Drive bot turns automatically with small, lifelike delays.
function maybeRunBot(room) {
  const game = room.game;
  if (!game || game.winner) return;
  const current = game.player(game.currentColor);
  if (!current || !current.isBot) return;

  setTimeout(() => {
    if (!room.game || room.game.winner) return;
    if (room.game.currentColor !== current.color) return; // turn moved on

    const roll = room.game.rollDice();
    broadcastRoom(room);
    if (!roll.ok) return;

    if (roll.noMoves || roll.burned) {
      // Turn already advanced inside rollDice.
      maybeRunBot(room);
      return;
    }

    setTimeout(() => {
      if (!room.game || room.game.currentColor !== current.color) {
        broadcastRoom(room);
        maybeRunBot(room);
        return;
      }
      const tokenIdx = room.game.botChooseToken();
      const result = room.game.moveToken(current.color, tokenIdx);
      broadcastRoom(room);
      if (result.gameOver) {
        systemChat(room, `Game over! ${room.game.winner.toUpperCase()} wins.`);
        return;
      }
      maybeRunBot(room);
    }, 650);
  }, 700);
}

// ------------------------------------------------------------------- sockets
io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.on('room:create', ({ name }, cb) => {
    const room = manager.createRoom(socket.id, sanitizeName(name));
    socket.join(room.code);
    socket.data.roomCode = room.code;
    cb && cb({ ok: true, code: room.code, you: socket.id });
    broadcastRoom(room);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    const res = manager.joinRoom(code, socket.id, sanitizeName(name));
    if (res.error) return cb && cb({ ok: false, error: res.error });
    socket.join(res.room.code);
    socket.data.roomCode = res.room.code;
    cb && cb({ ok: true, code: res.room.code, you: socket.id });
    systemChat(res.room, `${res.seat.name} joined the game.`);
    broadcastRoom(res.room);
  });

  socket.on('room:reconnect', ({ code }, cb) => {
    const room = manager.reconnect(socket.id, code);
    if (!room) return cb && cb({ ok: false });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    cb && cb({ ok: true, code: room.code, you: socket.id });
    broadcastRoom(room);
  });

  socket.on('room:addBot', (_payload, cb) => {
    const res = manager.addBot(socket.data.roomCode, socket.id);
    if (res.error) return cb && cb({ ok: false, error: res.error });
    cb && cb({ ok: true });
    broadcastRoom(res.room);
  });

  socket.on('room:removeSeat', ({ seatId }, cb) => {
    const res = manager.removeSeat(socket.data.roomCode, seatId, socket.id);
    if (res.error) return cb && cb({ ok: false, error: res.error });
    cb && cb({ ok: true });
    broadcastRoom(res.room);
  });

  socket.on('game:start', (_payload, cb) => {
    const res = manager.startGame(socket.data.roomCode, socket.id);
    if (res.error) return cb && cb({ ok: false, error: res.error });
    cb && cb({ ok: true });
    systemChat(res.room, 'The game has started. Good luck!');
    broadcastRoom(res.room);
    maybeRunBot(res.room);
  });

  socket.on('game:roll', (_payload, cb) => {
    const room = manager.getRoom(socket.data.roomCode);
    if (!room || !room.game) return cb && cb({ ok: false, error: 'No game.' });
    const seat = room.seats.find((s) => s.id === socket.id);
    if (!seat || seat.color !== room.game.currentColor) {
      return cb && cb({ ok: false, error: 'Not your turn.' });
    }
    const roll = room.game.rollDice();
    cb && cb(roll);
    broadcastRoom(room);
    if (roll.ok && (roll.noMoves || roll.burned)) maybeRunBot(room);
  });

  socket.on('game:move', ({ token }, cb) => {
    const room = manager.getRoom(socket.data.roomCode);
    if (!room || !room.game) return cb && cb({ ok: false, error: 'No game.' });
    const seat = room.seats.find((s) => s.id === socket.id);
    if (!seat) return cb && cb({ ok: false, error: 'Not in this game.' });

    const result = room.game.moveToken(seat.color, token);
    cb && cb(result);
    if (!result.ok) return;
    broadcastRoom(room);
    if (result.gameOver) {
      systemChat(room, `Game over! ${room.game.winner.toUpperCase()} wins.`);
      return;
    }
    maybeRunBot(room);
  });

  socket.on('chat:send', ({ text }, cb) => {
    const room = manager.getRoom(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false });
    const seat = room.seats.find((s) => s.id === socket.id);
    const clean = String(text || '').slice(0, 240).trim();
    if (!clean) return cb && cb({ ok: false });
    const entry = {
      name: seat ? seat.name : 'spectator',
      color: seat ? seat.color : 'system',
      text: clean,
      ts: Date.now(),
    };
    room.chat.push(entry);
    if (room.chat.length > 200) room.chat.shift();
    io.to(room.code).emit('chat:message', entry);
    cb && cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const affected = manager.handleDisconnect(socket.id);
    for (const room of affected) {
      const seat = room.seats.find((s) => s.connected === false);
      if (seat && room.started) systemChat(room, `${seat.name} disconnected.`);
      broadcastRoom(room);
      // If it's now a bot/no-one's turn that needs driving, keep things moving.
      if (room.game && !room.game.winner) maybeRunBot(room);
    }
  });
});

function sanitizeName(name) {
  const clean = String(name || '').replace(/[<>]/g, '').trim().slice(0, 18);
  return clean || 'Player';
}

server.listen(PORT, () => {
  console.log(`Ludo King server running on http://localhost:${PORT}`);
});

module.exports = { app, server, io, manager };
