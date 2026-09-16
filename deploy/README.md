# Pi backend and Vercel frontend

The production backend runs on this Raspberry Pi as the `neon-apex` user
service. It listens on `127.0.0.1:3002`. Port 3001 remains available to the
existing development server. Tailscale Funnel forwards public HTTPS and
WebSocket connections to port 3002.

- Frontend: https://racing-game-sooty-eta.vercel.app
- Backend WebSocket: `wss://raspberrypi.tail5bc185.ts.net/ws`
- Service environment: `/home/ric/.config/neon-apex/server.env`
- Installed unit: `/home/ric/.config/systemd/user/neon-apex.service`

## Vercel

Set `VITE_WS_URL=wss://raspberrypi.tail5bc185.ts.net/ws` in the project's
Production environment, then redeploy. Vite embeds the URL during the build.
The repository's `vercel.json` selects Vite, `npm run build`, and `dist`.

The server allows the exact production frontend origin. Preview deployment
addresses must be added explicitly to `ALLOWED_ORIGINS` if they should connect
to this backend. Separate multiple origins with commas and omit trailing slashes.

## Operate the Pi service

```bash
systemctl --user status neon-apex
journalctl --user -u neon-apex -n 50 --no-pager
systemctl --user restart neon-apex
tailscale funnel status
```

The service starts on boot because the `ric` user has lingering enabled.
It restarts after a crash. The unit uses this Pi's Node installation at
`/usr/local/bin/node` and this repository's location; adjust both when moving it.

To rebuild after updating the source or dependencies:

```bash
npm ci
npm run build
npm run build:server
systemctl --user restart neon-apex
```

The backend runs compiled JavaScript in `dist-server`, so editing TypeScript
does not change the running simulation until it is rebuilt and restarted.
Rooms live in memory. Restarting the server clears them, so update between races.

## Public tunnel

```bash
sudo tailscale funnel --bg --https=443 http://127.0.0.1:3002
```

Tailscale may first require the account owner to enable Funnel using the link
printed by the command. Background mode persists across Pi and Tailscale restarts.
Players do not need Tailscale installed. No router port forwarding is required.

To stop public access to this game:

```bash
sudo tailscale funnel --https=443 off
```

Funnel is in beta and has bandwidth limits. The Pi's Tailscale device key
currently expires on 2027-01-21; renew it before then or configure device key
expiry in the Tailscale admin console for unattended operation.

## Verify a deployment

```bash
node scripts/check-deployment.mjs wss://raspberrypi.tail5bc185.ts.net/ws https://racing-game-sooty-eta.vercel.app
```

This opens two real WebSocket connections, creates a room, and joins it from
the second connection. It closes both connections afterward. Run it from
outside the Pi's Tailscale network to verify public access as well.

References: [Tailscale Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel),
[Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).
