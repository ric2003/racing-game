# Neon Apex

Neon Apex is a desktop-browser multiplayer kart racing MVP built with React, Three.js, TypeScript, and raw WebSockets. Two to four players join a private room, race three laps on one procedural track, and receive server-authoritative standings.

## Requirements

- Node.js 20.19 or newer, or Node.js 22.12 or newer
- A modern desktop browser with WebGL and WebSocket support

## Run locally

```bash
npm ci
npm run dev
```

Open the Vite URL printed in the terminal. `npm run dev` starts both the Vite client and the authoritative server. The Vite development server proxies `/ws` to port 3001.

## Production-style local run

```bash
npm run build
npm run start
```

Open `http://localhost:3001`. The Node process serves `dist/` and accepts WebSocket connections at `/ws`.

## Controls

- `WASD` or arrow keys: accelerate, reverse, and steer
- `Space`: brake
- `E`: use the held item
- `R`: reset to the nearest legal point on the track

Click the game canvas before driving. This keeps gameplay keys from taking over the page when the game does not have focus.

## Two-browser smoke test

1. Create a room in Browser A and copy its six-character code.
2. Join from Browser B with a different racer name.
3. Start from Browser A, then confirm both clients show the same countdown.
4. Drive both karts and confirm remote motion, collisions, lap state, and standings match.
5. Finish three laps, then confirm both browsers show the same results.

## Validation

```bash
npm run test
npm run lint
npm run build
```

The test suite covers simulation rules, checkpoint order, protocol rejection, room limits, host permissions, and a live two-client WebSocket flow.

## Architecture

- `src/shared/` contains framework-free track, simulation, race, and protocol code.
- `server/` owns rooms, movement, collisions, checkpoints, laps, finish order, input validation, and static hosting.
- `src/game/` owns Three.js rendering, keyboard input, local prediction, reconciliation, and remote interpolation.
- `src/network/` owns the browser WebSocket connection. Clients send controls and lobby actions, never race state.

The server runs a fixed 60 Hz simulation and sends snapshots at 20 Hz. Clients send bounded controls at 30 Hz. The local kart uses prediction with authoritative correction; remote karts render from a short snapshot buffer. Race settings, lap timing, item effects, hazards, standings, and finish awards are authoritative snapshots from the server.

## Environment

- `PORT`: server port, default `3001`
- `HOST`: bind host, default `0.0.0.0`
- `MAX_CONNECTIONS`: global WebSocket connection cap, default `64`
- `ALLOWED_ORIGINS`: comma-separated origin allowlist for WebSocket upgrades. Without it, localhost origins are allowed.
- `VITE_WS_URL`: optional full browser WebSocket URL. The default is same-origin `/ws`.

## MVP limits

This is a single-process private-room MVP, not a production live service. It has no accounts, persistence, matchmaking, free-form chat, bots, mobile controls, or multi-instance room coordination. Reconnect tokens are short-lived room credentials, not accounts or host authentication. Room codes provide discovery, not identity. Put TLS and WSS at the hosting edge before exposing the server to the internet.
# racing-game
