# 🎲 Ludo King — Multiplayer

A real-time, **multi-user Ludo** game (2–4 players) you can play with friends in
the browser. Players join a shared room with a code; the server runs the
authoritative game so nobody can cheat. Bots can fill empty seats so you can
also play solo.

![board](https://img.shields.io/badge/players-2--4-blue) ![tech](https://img.shields.io/badge/realtime-Socket.IO-black) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Real-time multiplayer** over WebSockets (Socket.IO) — create a room, share
  the 5-letter code, and friends join instantly.
- **Server-authoritative rules** — dice rolls, moves, captures and wins are all
  validated on the server.
- **Full Ludo ruleset**
  - Roll a **6** to bring a token out of the yard.
  - A **6**, a **capture**, or **sending a token home** grants an extra turn.
  - **Three 6s in a row** burns your turn.
  - **Capture** opponents by landing on them — except on the 8 **safe star**
    squares.
  - **Exact roll** required to finish; first player home wins.
- **Bots** to fill seats (simple capture/advance heuristic) — play with any mix
  of humans and bots.
- **Live chat**, turn indicators, capture/home notifications, and a winner
  podium.
- **Responsive** canvas board that works on desktop and mobile.
- **Reconnect-friendly** room handling and graceful disconnect notices.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a few browser tabs (or share the room
code across devices on your network).

> Dev mode with auto-reload: `npm run dev`
> Custom port: `PORT=8080 npm start`

## How to play

1. Enter your name and click **Create new game**.
2. Share the **room code** with friends, or click **+ Add bot** to fill seats.
3. The host clicks **Start game** (needs at least 2 players).
4. On your turn, press **Roll dice**, then tap a highlighted token to move it.
5. Get all 4 tokens home first to win! 🏆

## Project structure

```
.
├── server/
│   ├── index.js        # Express + Socket.IO server, bot turn driver
│   ├── GameManager.js  # Room / lobby lifecycle (create, join, bots, GC)
│   └── LudoGame.js     # Authoritative rules engine (dice, moves, captures, win)
├── public/
│   ├── index.html      # Lobby + room + game screens
│   ├── styles.css      # UI styling
│   └── js/
│       ├── constants.js# Board geometry (52-cell path, home lanes, safe cells)
│       ├── board.js    # Canvas renderer + click hit-testing
│       └── app.js       # Socket client + UI controller
├── test/
│   └── game.test.js    # Rules-engine unit tests (no framework)
└── package.json
```

## How it works

The board is a standard 15×15 Ludo cross. The shared track is a **52-cell ring**;
each colour enters at a fixed start index (0 / 13 / 26 / 39). A token's
*progress* runs `0..56`:

| progress | meaning |
|----------|---------|
| `0..50`  | on the shared ring at `(start + progress) % 52` |
| `51..56` | in that colour's 6-cell home lane |
| `56`     | finished (home) |

The server (`LudoGame`) holds the only real game state and emits a sanitised
`snapshot()` to every client after each action. Clients render that snapshot and
send back only intents (`game:roll`, `game:move`) — which the server validates.

### Socket events

| Event | Direction | Payload |
|-------|-----------|---------|
| `room:create` / `room:join` | client → server | `{ name, code? }` |
| `room:addBot` / `room:removeSeat` | client → server | host only |
| `game:start` | client → server | host only |
| `game:roll` / `game:move` | client → server | `{ token }` for move |
| `chat:send` | client → server | `{ text }` |
| `room:update` | server → clients | full public room + game snapshot |
| `chat:message` | server → clients | one chat line |

## Tests

```bash
npm test
```

Covers leaving the yard, the three-sixes rule, captures, safe squares, exact-roll
home entry, and win detection. The engine has also been fuzzed over hundreds of
randomly-played full games to confirm no deadlocks.

## License

MIT
