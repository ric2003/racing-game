# Neon Apex Feature Roadmap

This roadmap is organized so each feature can be developed and reviewed in its own branch. Start every branch from the latest stable `main`, keep unrelated cleanup out of the branch, and merge only after its tests pass.

## Recommended branch workflow

```bash
git switch main
git pull
git switch -c feature/lap-timing

# Implement and validate the feature.
npm test
npm run lint
npm run build

git add .
git commit -m "Add lap timing and sector splits"
```

After merging a feature, update `main` before starting a feature that depends on it.

## Suggested implementation order

1. Lap timing and sector splits
2. Minimap
3. Rematch flow
4. Starting boost
5. Off-road handling
6. Drift and mini-turbo
7. Slipstreaming
8. Time-trial ghosts
9. Track hazards and boost pads
10. Knockout mode

---

## 1. Lap timing and sector splits

**Branch:** `feature/lap-timing`

**Goal:** Give racers immediate feedback about their pace.

### Scope

- Track the start time, current lap time, previous lap time, and best lap.
- Treat the existing eight checkpoints as timing sectors.
- Show a green sector delta when faster than the racer’s best and red when slower.
- Display the current lap timer in the race HUD.
- Include final lap times in the results panel.
- Keep timing server-authoritative.

### Likely files

- `src/shared/race.ts`
- `src/shared/protocol.ts`
- `server/room.ts`
- `src/App.tsx`
- `src/App.css`
- `tests/shared/race.test.ts`
- `tests/server/room.test.ts`

### Acceptance criteria

- The timer starts when racing begins, not during the countdown.
- Crossing the finish line records exactly one lap time.
- Best lap only changes when a faster valid lap is completed.
- Resetting the kart does not reset the active lap timer.
- All clients display the same authoritative lap results.

---

## 2. Minimap

**Branch:** `feature/minimap`

**Goal:** Help players understand the larger circuit and nearby opponents.

### Scope

- Render a simplified top-down outline from `TRACK_POINTS`.
- Draw one colored dot per kart.
- Rotate the minimap so the start line is consistently at the bottom, or keep north fixed for all players.
- Highlight the local player with a white ring.
- Place the minimap in the lower-right corner without overlapping standings or controls.
- Use a lightweight 2D canvas or SVG; do not create a second Three.js renderer.

### Likely files

- `src/game/Minimap.tsx`
- `src/shared/track.ts`
- `src/App.tsx`
- `src/App.css`
- `tests/shared/track.test.ts`

### Acceptance criteria

- Every racer dot follows the correct track position.
- The map scales correctly at different desktop resolutions.
- Joining or leaving removes dots without errors.
- The minimap does not noticeably reduce frame rate.

---

## 3. Rematch flow

**Branch:** `feature/rematch`

**Goal:** Let the same room race again without reconnecting.

### Scope

- Add a host-only “Race again” action on the results screen.
- Reset every kart, lap, checkpoint, finish place, timer, and queued input.
- Return the room to a fresh countdown.
- Keep the same room code, host, player names, slots, and colors.
- Disable the action until all connected clients have received the finished snapshot.

### Likely files

- `src/shared/protocol.ts`
- `server/validation.ts`
- `server/game-server.ts`
- `server/room.ts`
- `src/network/client.ts`
- `src/App.tsx`
- `tests/server/protocol.test.ts`
- `tests/server/room.test.ts`

### Acceptance criteria

- Only the host can start a rematch.
- All racers return to their original grid slots.
- Old inputs cannot move a kart during the new countdown.
- Lap and finish data from the previous race is fully cleared.

---

## 4. Starting boost

**Branch:** `feature/starting-boost`

**Goal:** Reward accurate countdown timing.

### Scope

- Detect when acceleration is first pressed near the end of the countdown.
- Award a short acceleration boost when pressed during the ideal window.
- Apply a brief engine bog when held too early.
- Show a small “Perfect start” or “Early!” message locally.
- Calculate the result on the server from authoritative input arrival time.

### Default tuning

- Perfect window: final 250 ms before racing begins.
- Boost duration: 700 ms.
- Boost acceleration multiplier: `1.35`.
- Early-start bog duration: 500 ms.

### Acceptance criteria

- Holding acceleration throughout the countdown does not award a boost.
- Network latency cannot produce impossible speeds.
- Start outcomes are deterministic in room tests using a controlled clock.

---

## 5. Off-road handling

**Branch:** `feature/offroad-handling`

**Goal:** Replace the invisible hard track boundary with recoverable grass driving.

### Scope

- Allow karts to travel a limited distance beyond the curb.
- Reduce acceleration, maximum speed, and lateral grip while on grass.
- Apply the hard constraint only beyond a wider recovery boundary.
- Reset a kart if it remains far from the track or becomes stuck.
- Add subtle grass particles or wheel color feedback later; gameplay comes first.

### Default tuning

- Grass maximum speed: 55% of road maximum.
- Grass acceleration: 45% of road acceleration.
- Grass lateral grip: 65% of road grip.
- Recovery boundary: `TRACK_WIDTH / 2 + 12`.

### Acceptance criteria

- Cutting across the inside of a curve is slower than following the road.
- A kart can recover without pressing reset after a small mistake.
- Karts cannot leave the playable ground indefinitely.
- Collision resolution remains stable when racers are on different surfaces.

---

## 6. Drift and mini-turbo

**Branch:** `feature/drift-boost`

**Goal:** Add a skill-based cornering mechanic.

### Scope

- Use `Shift` as the drift input.
- Start a drift only while moving above a minimum speed and steering.
- Reduce lateral grip while drifting and allow a controlled slip angle.
- Charge a mini-turbo from drift duration and steering intensity.
- Release the drift key to apply the earned boost.
- Replicate drift state through the existing input protocol.
- Add wheel angle, body lean, tire marks, and charge color feedback.

### Default tuning

- Minimum drift speed: 8 units/second.
- Charge tiers: 0.6 seconds and 1.3 seconds.
- Tier-one boost: 0.55 seconds.
- Tier-two boost: 0.95 seconds.
- Cancel the charge after a collision or when speed falls below the minimum.

### Acceptance criteria

- Tapping drift cannot generate repeated free boosts.
- A good drift is faster than braking through a technical corner.
- The server and predicting client use identical drift calculations.
- Reconciliation does not repeatedly restart or cancel a drift.

---

## 7. Slipstreaming

**Branch:** `feature/slipstream`

**Dependency:** Preferably merge drift/boost first so all temporary speed effects share one boost model.

**Goal:** Create overtaking opportunities on the long straights.

### Scope

- Detect when one kart follows another within a narrow rear cone.
- Charge a slipstream meter while alignment and distance remain valid.
- Award a short boost after the meter fills.
- Break the charge when the trailing kart moves aside, falls back, or collides.
- Show wind streaks or a HUD indicator while charging.

### Default tuning

- Detection distance: 12 units.
- Rear cone: 24 degrees.
- Required following time: 1.2 seconds.
- Boost duration: 0.8 seconds.

### Acceptance criteria

- Side-by-side karts do not trigger slipstream.
- Drafting cannot activate through a distant section of track.
- The server decides eligibility and boost timing.

---

## 8. Time-trial ghosts

**Branch:** `feature/time-trial-ghost`

**Dependency:** Lap timing should be merged first.

**Goal:** Make the game useful and replayable with one player.

### Scope

- Add a Time Trial option on the landing screen.
- Permit a solo room without changing multiplayer minimum-player rules.
- Record the local kart transform and input sequence during the best lap.
- Replay the best lap as a transparent, non-colliding ghost.
- Store the best time and ghost locally by track version.
- Add a track version key so incompatible ghosts are discarded after layout changes.

### Acceptance criteria

- Ghosts never affect collisions, checkpoints, or standings.
- Replays remain synchronized for an entire lap.
- A slower completed lap does not overwrite the best ghost.
- Corrupt or outdated local ghost data fails safely.

---

## 9. Track hazards and boost pads

**Branch:** `feature/track-hazards`

**Goal:** Add alternate racing lines and risk/reward decisions.

### Initial content

- Two boost pads placed off the safest racing line.
- Two oil patches near corner exits.
- One moving barrier with a predictable cycle.
- Shared hazard definitions containing position, radius, type, and optional timing.
- Server-authoritative collision and effect application.

### Likely files

- `src/shared/hazards.ts`
- `src/shared/simulation.ts`
- `src/shared/protocol.ts`
- `server/room.ts`
- `src/game/track-mesh.ts`
- `tests/shared/simulation.test.ts`

### Acceptance criteria

- Hazards appear at the same location for every client.
- A hazard effect is applied once per valid contact, not every frame.
- Resetting near a hazard cannot immediately trap the kart.
- Moving hazards use server time and remain synchronized.

---

## 10. Knockout mode

**Branch:** `feature/knockout-mode`

**Dependency:** Rematch and lap timing are useful foundations but not mandatory.

**Goal:** Add a shorter high-pressure alternative to the three-lap race.

### Scope

- Let the host choose Standard Race or Knockout before starting.
- At designated checkpoint gates, eliminate the racer in last place.
- Require at least three racers for Knockout.
- Turn eliminated racers into spectators.
- End when one racer remains.
- Include the selected mode in lobby and snapshot messages.

### Default rules

- No elimination during the opening section.
- First elimination after checkpoint four.
- Additional elimination every four checkpoints.
- Ties use authoritative track progress, then stable player ID ordering.

### Acceptance criteria

- All clients agree on the eliminated racer.
- Disconnections do not eliminate an extra active racer.
- Spectators cannot send effective driving inputs.
- The last remaining racer receives first place and the finished state.

---

## Branch hygiene checklist

Use this checklist for every feature:

- [ ] Branch contains only one roadmap feature.
- [ ] Shared protocol changes validate unknown and malformed messages.
- [ ] Server remains authoritative for competitive outcomes.
- [ ] Client prediction uses the same shared simulation functions as the server.
- [ ] Keyboard controls are documented in the HUD and README.
- [ ] Existing multiplayer behavior still passes.
- [ ] New logic has unit or room tests.
- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Two-browser smoke test completed.

