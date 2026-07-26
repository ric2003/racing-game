import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import { GameCanvas } from './game/GameCanvas.js'
import { GameClient, type NetworkState } from './network/client.js'
import { LAPS_TO_WIN } from './shared/constants.js'

const NAME_PATTERN = /^[A-Za-z0-9 _-]{2,16}$/

const EMPTY_NETWORK: NetworkState = {
  status: 'idle',
  playerId: null,
  roomCode: null,
  lobby: null,
  snapshot: null,
  error: null,
}

function App() {
  const [client] = useState(() => new GameClient())
  const [network, setNetwork] = useState<NetworkState>(EMPTY_NETWORK)
  const [name, setName] = useState(() => localStorage.getItem('neon-apex-name') ?? '')
  const [roomCode, setRoomCode] = useState('')
  const [joinMode, setJoinMode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = client.subscribe(setNetwork)
    return () => {
      unsubscribe()
      client.disconnect()
    }
  }, [client])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!NAME_PATTERN.test(cleanName)) {
      setNameError('Use 2 to 16 letters or numbers. Spaces, underscores, and hyphens are allowed.')
      return
    }
    setNameError(null)
    localStorage.setItem('neon-apex-name', cleanName)
    if (joinMode) client.joinRoom(cleanName, roomCode.trim().toUpperCase())
    else client.createRoom(cleanName)
  }

  const leave = () => {
    client.disconnect()
    setCopied(false)
  }

  const copyCode = async () => {
    if (!network.roomCode) return
    await navigator.clipboard.writeText(network.roomCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  const phase = network.snapshot?.phase ?? network.lobby?.phase ?? 'lobby'
  const localKart = network.snapshot?.karts.find((kart) => kart.id === network.playerId)
  const isHost = network.playerId !== null && network.lobby?.hostId === network.playerId
  const hasEnoughRacers = (network.lobby?.players.length ?? 0) >= 2
  const canStart = isHost && hasEnoughRacers
  const countdown = network.snapshot?.countdownEndsAt
    ? Math.max(0, Math.ceil((network.snapshot.countdownEndsAt - network.snapshot.serverTime) / 1_000))
    : 0

  if (!network.roomCode || !network.playerId || !network.lobby) {
    return (
      <main className="landing">
        <div className="landing-glow landing-glow-one" />
        <div className="landing-glow landing-glow-two" />
        <section className="brand-panel" aria-labelledby="game-title">
          <div className="brand-mark" aria-hidden="true"><span>NA</span></div>
          <p className="eyebrow">REAL-TIME MULTIPLAYER</p>
          <h1 id="game-title">NEON<br /><em>APEX</em></h1>
          <p className="tagline">Four karts. Three laps. One clean line.</p>
          <div className="feature-row" aria-label="Game features">
            <span>2–4 racers</span><span>Live rooms</span><span>Arcade handling</span>
          </div>
        </section>

        <section className="join-card" aria-labelledby="join-heading">
          <div className="card-kicker">RACE CONTROL</div>
          <h2 id="join-heading">{joinMode ? 'Join the grid' : 'Create a room'}</h2>
          <p>{joinMode ? 'Enter the six-character code from your host.' : 'Start a private room, then share the code.'}</p>
          <form onSubmit={submit}>
            <label htmlFor="racer-name">Racer name</label>
            <input
              id="racer-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
              aria-describedby={nameError ? 'racer-name-error' : undefined}
              aria-invalid={nameError ? true : undefined}
              minLength={2}
              maxLength={16}
              pattern="[A-Za-z0-9 _-]{2,16}"
              placeholder="TurboFox"
              autoComplete="nickname"
              required
            />
            {nameError && <p id="racer-name-error" className="field-error" role="alert">{nameError}</p>}
            {joinMode && (
              <>
                <label htmlFor="room-code">Room code</label>
                <input
                  id="room-code"
                  className="code-input"
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6))}
                  minLength={6}
                  maxLength={6}
                  placeholder="A7K9PX"
                  autoComplete="off"
                  required
                />
              </>
            )}
            <button className="primary-button" type="submit" disabled={network.status === 'connecting'}>
              {network.status === 'connecting' ? 'Connecting…' : joinMode ? 'Join race' : 'Create race'}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <button className="text-button" type="button" onClick={() => {
            setJoinMode(!joinMode)
            setNameError(null)
          }}>
            {joinMode ? 'Want to host? Create a room' : 'Have a code? Join a room'}
          </button>
          {network.error && <p className="form-error" role="alert">{network.error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="race-app">
      {network.snapshot && <GameCanvas client={client} playerId={network.playerId} snapshot={network.snapshot} />}
      <header className="topbar">
        <a className="mini-brand" href="/" onClick={(event) => { event.preventDefault(); leave() }} aria-label="Leave race and return home">
          <span>NA</span> NEON APEX
        </a>
        <div className="room-chip">
          <span>ROOM</span>
          <strong>{network.roomCode}</strong>
          <button type="button" onClick={copyCode} aria-label={copied ? 'Room code copied' : 'Copy room code'}>{copied ? 'COPIED' : 'COPY'}</button>
          <span className="sr-only" aria-live="polite">{copied ? 'Room code copied.' : ''}</span>
        </div>
        <div className={`connection ${network.status}`}><i />{network.status === 'connected' ? 'LIVE' : 'OFFLINE'}</div>
      </header>

      {phase === 'lobby' && (
        <section className="lobby-panel glass-panel" aria-labelledby="lobby-title">
          <p className="panel-label">PRE-RACE LOBBY</p>
          <h2 id="lobby-title">Grid forming</h2>
          <p className="room-invite">Share <strong>{network.roomCode}</strong> with up to three friends.</p>
          <p className="sr-only" aria-live="polite">
            {`${network.lobby.players.length} racers joined. ${hasEnoughRacers ? isHost ? 'You can start the race.' : 'The host can start the race.' : 'Waiting for at least two racers.'}`}
          </p>
          <ul className="roster">
            {network.lobby.players.map((player, index) => (
              <li key={player.id}>
                <span className="kart-dot" style={{ backgroundColor: `#${player.color.toString(16).padStart(6, '0')}` }} />
                <strong>{player.name}</strong>
                <small>{player.id === network.lobby?.hostId ? 'HOST' : `P${index + 1}`}</small>
              </li>
            ))}
            {Array.from({ length: 4 - network.lobby.players.length }, (_, index) => <li className="empty-slot" key={`empty-${index}`}>Waiting for racer…</li>)}
          </ul>
          {isHost ? (
            <button className="primary-button" type="button" disabled={!canStart} onClick={() => client.startRace()}>
              {canStart ? 'Start race' : 'Waiting for one more racer'} <span aria-hidden="true">→</span>
            </button>
          ) : <p className="waiting-message">Waiting for the host to start…</p>}
          <button className="text-button" type="button" onClick={leave}>Leave room</button>
        </section>
      )}

      {phase === 'countdown' && (
        <div className="countdown" role="status" aria-live="assertive">
          <span>GET READY</span>
          <strong>{countdown || 'GO'}</strong>
        </div>
      )}

      {(phase === 'racing' || phase === 'countdown') && localKart && (
        <>
          <section className="race-hud" aria-label="Race status">
            <div><span>LAP</span><strong>{Math.min(localKart.lap + 1, LAPS_TO_WIN)}<small>/{LAPS_TO_WIN}</small></strong></div>
            <div><span>POSITION</span><strong>{(network.snapshot?.standings.findIndex((standing) => standing.id === network.playerId) ?? -1) + 1}<small>/{network.snapshot?.standings.length}</small></strong></div>
          </section>
          <aside className="standings glass-panel" aria-label="Live standings">
            <span>STANDINGS</span>
            {network.snapshot?.standings.map((standing) => (
              <div key={standing.id} className={standing.id === network.playerId ? 'is-you' : ''}>
                <b>{standing.place}</b><strong>{standing.name}</strong><small>{standing.finished ? 'FIN' : `L${Math.min(standing.lap + 1, LAPS_TO_WIN)}`}</small>
              </div>
            ))}
          </aside>
        </>
      )}

      {phase === 'finished' && (
        <section className="results-panel glass-panel" aria-labelledby="results-title">
          <p className="panel-label">RACE COMPLETE</p>
          <h2 id="results-title">Final standings</h2>
          <ol>
            {network.snapshot?.standings.map((standing) => (
              <li key={standing.id} className={standing.id === network.playerId ? 'is-you' : ''}>
                <span>{standing.place}</span><strong>{standing.name}</strong>{standing.id === network.playerId && <small>YOU</small>}
              </li>
            ))}
          </ol>
          <button className="primary-button" type="button" onClick={leave}>Back to race control <span aria-hidden="true">→</span></button>
        </section>
      )}

      {network.error && <div className="network-error" role="alert">{network.error}</div>}
      <footer className="controls-bar"><span><kbd>WASD</kbd> / <kbd>ARROWS</kbd> DRIVE</span><span><kbd>SPACE</kbd> BRAKE</span><span><kbd>R</kbd> RESET</span></footer>
    </main>
  )
}

export default App
