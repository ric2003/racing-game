import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import { GameCanvas } from './game/GameCanvas.js'
import { Minimap } from './game/Minimap.js'
import { bindingConflict, DEFAULT_KEY_BINDINGS, loadKeyBindings, saveKeyBindings, type BindingAction, type KeyBindings } from './game/input.js'
import { GameClient, type NetworkState } from './network/client.js'
import { getTrack, getTrackBounds } from './shared/track.js'
import { DEFAULT_RACE_SETTINGS } from './shared/constants.js'
import type { ItemType, KartSnapshot, RaceEvent, RaceSettings } from './shared/protocol.js'

const ITEM_INFO: Record<ItemType, { label: string; cue: string; symbol: string }> = {
  turbo: { label: 'TURBO', cue: 'Speed burst', symbol: '»' },
  shield: { label: 'SHIELD', cue: 'Blocks one hit', symbol: '◇' },
  'pulse-bolt': { label: 'PULSE BOLT', cue: 'Hits the racer ahead', symbol: '➤' },
  'oil-slick': { label: 'OIL SLICK', cue: 'Drops behind you', symbol: '●' },
}

const NAME_PATTERN = /^[A-Za-z0-9 _-]{2,16}$/
type CopyFeedback = 'code' | 'invite' | 'error' | null

const EMPTY_NETWORK: NetworkState = {
  status: 'idle',
  playerId: null,
  roomCode: null,
  lobby: null,
  snapshot: null,
  reconnectToken: null,
  reaction: null,
  error: null,
}

function App() {
  const [client] = useState(() => new GameClient())
  const [network, setNetwork] = useState<NetworkState>(EMPTY_NETWORK)
  const [name, setName] = useState(() => localStorage.getItem('neon-apex-name') ?? '')
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '')
  const [joinMode, setJoinMode] = useState(() => Boolean(new URLSearchParams(window.location.search).get('room')))
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [showControls, setShowControls] = useState(false)
  const [bindings, setBindings] = useState<KeyBindings>(() => loadKeyBindings())
  const [rebinding, setRebinding] = useState<BindingAction | null>(null)
  const [bindingError, setBindingError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = client.subscribe(setNetwork)
    return () => {
      unsubscribe()
      client.disconnect()
    }
  }, [client])

  useEffect(() => {
    if (!rebinding || !showControls) return undefined
    const capture = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.repeat) return
      if (event.code === 'Escape') {
        setBindingError(null)
        setRebinding(null)
        return
      }
      if (!event.code) return
      const conflict = bindingConflict(bindings, rebinding, event.code)
      if (conflict) {
        setBindingError(`${formatBinding(event.code)} is already used for ${bindingLabel(conflict)}. Choose another key.`)
        return
      }
      setBindingError(null)
      const next = { ...bindings, [rebinding]: event.code }
      saveKeyBindings(next)
      setBindings(next)
      setRebinding(null)
    }
    window.addEventListener('keydown', capture)
    return () => window.removeEventListener('keydown', capture)
  }, [bindings, rebinding, showControls])

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
    setCopyFeedback(null)
  }

  const copyCode = async () => {
    if (!network.roomCode) return
    showCopyFeedback(await copyText(network.roomCode) ? 'code' : 'error')
  }

  const copyInvite = async () => {
    if (!network.roomCode) return
    showCopyFeedback(await copyText(`${window.location.origin}/?room=${network.roomCode}`) ? 'invite' : 'error')
  }

  const showCopyFeedback = (feedback: CopyFeedback) => {
    setCopyFeedback(feedback)
    window.setTimeout(() => setCopyFeedback(null), 1_800)
  }

  const phase = network.snapshot?.phase ?? network.lobby?.phase ?? 'lobby'
  const settings = network.snapshot?.settings ?? network.lobby?.settings ?? DEFAULT_RACE_SETTINGS
  const localKart = network.snapshot?.karts.find((kart) => kart.id === network.playerId)
  const heldItem = localKart?.heldItem ?? null
  const heldItemInfo = heldItem ? ITEM_INFO[heldItem] : null
  const itemNotice = network.snapshot && network.playerId
    ? latestItemNotice(network.snapshot.events ?? [], network.snapshot.karts, network.playerId, network.snapshot.serverTime)
    : null
  const isHost = network.playerId !== null && network.lobby?.hostId === network.playerId
  const racerCount = network.lobby?.players.filter((player) => player.connected !== false).length ?? 0
  const minimumRacers = settings.mode === 'knockout' ? 3 : 2
  const hasEnoughRacers = racerCount >= minimumRacers
  const canStart = isHost && hasEnoughRacers
  const voteCount = Object.keys(network.lobby?.votes ?? {}).length
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
            <span>2–4 racers</span><span>Live rooms</span><span>Items + boosts</span>
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
              pattern="[A-Za-z0-9 _\-]{2,16}"
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
      {network.snapshot && <GameCanvas client={client} playerId={network.playerId} snapshot={network.snapshot} inputEnabled={!showControls} />}
      <header className={`topbar ${phase === 'lobby' ? '' : 'topbar-racing'}`}>
        {phase === 'lobby' && <a className="mini-brand" href="/" onClick={(event) => { event.preventDefault(); leave() }} aria-label="Leave race and return home">
          <span>NA</span> NEON APEX
        </a>}
        {phase !== 'lobby' && <div className="room-chip">
          <span>ROOM</span>
          <strong>{network.roomCode}</strong>
          <button type="button" onClick={copyCode} aria-label={copyFeedback === 'code' ? 'Room code copied' : 'Copy room code'}>{copyFeedback === 'code' ? 'COPIED' : 'COPY'}</button>
          <button type="button" onClick={copyInvite} aria-label={copyFeedback === 'invite' ? 'Invite link copied' : 'Copy invite link'}>{copyFeedback === 'invite' ? 'COPIED' : 'LINK'}</button>
          {copyFeedback === 'error' && <span className="copy-status is-error">COPY FAILED</span>}
          <span className="sr-only" aria-live="polite">{copyFeedback === 'code' ? 'Room code copied.' : copyFeedback === 'invite' ? 'Invite link copied.' : copyFeedback === 'error' ? 'Could not copy.' : ''}</span>
        </div>}
        {phase === 'lobby' && <div className={`connection ${network.status}`}><i />{network.status === 'connected' ? 'LIVE' : 'OFFLINE'}</div>}
        {phase !== 'finished' && network.status === 'disconnected' && network.reconnectToken && network.roomCode && (
          <button className="reconnect-button" type="button" onClick={() => client.resumeRoom(name, network.roomCode!, network.reconnectToken!)}>RECONNECT</button>
        )}
      </header>

      {phase === 'lobby' && (
        <section className="lobby-panel glass-panel" aria-label="Pre-race lobby">
          <div className="lobby-content">
            <div className="lobby-heading">
              <h2>{isHost ? 'Set up race' : 'Race lobby'}</h2>
              <span aria-live="polite">{racerCount} / 4 racers</span>
            </div>
            <button className="lobby-invite" type="button" onClick={copyInvite} aria-label="Copy invite link">
              <span>{copyFeedback === 'invite' ? 'Invite copied' : copyFeedback === 'error' ? 'Copy failed. Try again' : 'Invite friends'}</span>
              <strong>{network.roomCode}</strong>
            </button>
            <span className="sr-only" aria-live="polite">{copyFeedback === 'invite' ? 'Invite link copied.' : copyFeedback === 'error' ? 'Could not copy invite link.' : ''}</span>
            <ul className="roster" aria-label="Racers">
              {network.lobby.players.map((player) => (
                <li key={player.id} className={player.connected === false ? 'is-disconnected' : ''}>
                  <span className="kart-dot" style={{ backgroundColor: `#${player.color.toString(16).padStart(6, '0')}` }} />
                  <strong>{player.name}</strong>
                  {player.connected === false ? <small>Away</small> : player.id === network.lobby?.hostId ? <small>Host</small> : null}
                </li>
              ))}
            </ul>

            <div className="lobby-settings" data-driving-menu>
              {!isHost && <p className="lobby-hint">The host sets the race. You can vote below.</p>}
              <div className="track-selection">
                <TrackPreview trackId={settings.trackId} />
                <div className="track-selection-fields">
                  <label htmlFor="race-track">Track</label>
                  <select id="race-track" value={settings.trackId} disabled={!isHost} onChange={(event) => client.updateRaceSettings({ ...settings, trackId: event.target.value })}>
                    {(network.lobby.trackOptions ?? []).map((track) => <option key={track.id} value={track.id}>{track.name}{getTrack(track.id).theme ? ' · Long' : ''}</option>)}
                  </select>
                  <p className="lobby-hint">{getTrack(settings.trackId).theme ? 'Endurance circuit. 10× distance.' : 'Short circuit'}</p>
                </div>
              </div>
              {getTrack(settings.trackId).theme && <p className="lobby-hint">One lap is a good place to start.</p>}
              {voteCount > 0 && <p className="lobby-hint">{voteCount} {voteCount === 1 ? 'vote' : 'votes'} cast. Most-voted track wins.</p>}
              <fieldset className="lap-picker" disabled={!isHost}>
                <legend>Laps</legend>
                <div>
                  {[1, 2, 3, 5].map((laps) => <button key={laps} type="button" aria-pressed={settings.laps === laps} onClick={() => client.updateRaceSettings({ ...settings, laps: laps as RaceSettings['laps'] })}>{laps}</button>)}
                </div>
              </fieldset>
              <label className="lobby-items">
                <span>Items<small>Pick up boosts and power-ups</small></span>
                <input type="checkbox" role="switch" checked={settings.itemsEnabled} disabled={!isHost} onChange={(event) => client.updateRaceSettings({ ...settings, itemsEnabled: event.target.checked })} />
              </label>
              <details className="lobby-options">
                <summary>Mode &amp; track voting<span>{settings.mode === 'knockout' ? 'Knockout' : 'Standard'}</span></summary>
                <div className="lobby-options-content">
                  <label htmlFor="race-mode">Race mode</label>
                  <select id="race-mode" value={settings.mode} disabled={!isHost} onChange={(event) => client.updateRaceSettings({ ...settings, mode: event.target.value as RaceSettings['mode'] })}>
                    <option value="standard">Standard</option>
                    <option value="knockout" disabled={racerCount < 3}>Knockout · 3+ racers</option>
                  </select>
                  <label htmlFor="track-vote">Your track vote</label>
                  <select id="track-vote" value={network.lobby.votes?.[network.playerId] ?? ''} onChange={(event) => client.voteTrack(event.target.value)}>
                    <option value="" disabled>Choose a track</option>
                    {(network.lobby.trackOptions ?? []).map((track) => <option key={track.id} value={track.id}>{track.name} · {Object.values(network.lobby?.votes ?? {}).filter((vote) => vote === track.id).length} votes</option>)}
                  </select>
                </div>
              </details>
            </div>
          </div>
          <div className="lobby-actions">
            <p className="lobby-status" role="status">{!hasEnoughRacers ? `Waiting for ${minimumRacers - racerCount} more ${minimumRacers - racerCount === 1 ? 'racer' : 'racers'}` : !isHost ? 'Waiting for the host' : 'Everyone’s in. Ready when you are.'}</p>
            <div className="lobby-action-row">
              <button className="text-button" type="button" onClick={leave}>Leave</button>
              <button className="primary-button" type="button" disabled={!canStart} onClick={() => client.startRace()}>Start race <span className="start-flag" aria-hidden="true" /></button>
            </div>
          </div>
        </section>
      )}

      {phase === 'countdown' && (
        <div className="countdown" role="status" aria-live="assertive">
          <span>GET READY</span>
          <strong>{countdown || 'GO'}</strong>
        </div>
      )}

      {showControls && (phase === 'lobby' || phase === 'countdown' || phase === 'racing') && (
        <section className="controls-overlay glass-panel" aria-label="Driving controls">
          <p className="panel-label">QUICK START</p>
          <h2>Find your line</h2>
          <p>{rebinding ? `Press a key for ${bindingLabel(rebinding)} (Esc cancels).` : 'Set your keys or keep the defaults.'}</p>
          {bindingError && <p className="field-error" role="alert">{bindingError}</p>}
          {!rebinding && <div className="binding-grid">
            {(Object.keys(DEFAULT_KEY_BINDINGS) as BindingAction[]).map((action) => <button type="button" key={action} onClick={() => { setBindingError(null); setRebinding(action) }}><span>{bindingLabel(action)}</span><kbd>{formatBinding(bindings[action])}</kbd></button>)}
          </div>}
          <button className="primary-button" type="button" onClick={() => { localStorage.setItem('neon-apex-controls-seen', '1'); setShowControls(false); setRebinding(null); setBindingError(null) }}>Got it <span aria-hidden="true">→</span></button>
        </section>
      )}

      {(phase === 'racing' || phase === 'countdown') && localKart && network.snapshot && (
        <>
          <section className="race-hud" aria-label="Race status">
            <div><span>LAP</span><strong>{Math.min(localKart.lap + 1, settings.laps)}<small>/{settings.laps}</small></strong></div>
            <div><span>TIME</span><strong className="hud-time">{formatTime(network.snapshot.standings.find((standing) => standing.id === network.playerId)?.lapTime ?? null)}</strong></div>
          </section>
          {settings.itemsEnabled && <section className={`item-hud ${heldItem ? `has-item item-${heldItem}` : ''}`} aria-label="Held item">
            <span>{heldItem ? 'ITEM READY' : 'ITEM'}</span>
            <strong>{heldItemInfo ? <><i aria-hidden="true">{heldItemInfo.symbol}</i>{heldItemInfo.label}</> : '—'}</strong>
            <small className="item-cue">{heldItemInfo?.cue ?? 'Drive through a blue box'}</small>
            <small className="item-key">PRESS <kbd>{formatBinding(bindings.item)}</kbd> TO USE</small>
          </section>}
          <aside className="standings glass-panel" aria-label="Live standings">
            <span>STANDINGS</span>
            {network.snapshot.standings.map((standing) => (
              <div key={standing.id} className={`${standing.id === network.playerId ? 'is-you' : ''} ${standing.eliminated ? 'is-eliminated' : ''}`}>
                <b>{standing.place}</b><strong>{standing.name}</strong><small>{standing.eliminated ? 'OUT' : standing.finished ? 'FIN' : `L${Math.min(standing.lap + 1, settings.laps)}`}</small>
              </div>
            ))}
          </aside>
          <Minimap snapshot={network.snapshot} playerId={network.playerId} />
        </>
      )}

      {phase === 'finished' && (
        <section className="results-panel glass-panel" aria-labelledby="results-title">
          <p className="panel-label">RACE COMPLETE</p>
          <h2 id="results-title">Final standings</h2>
          <ol>
            {network.snapshot?.standings.map((standing) => (
              <li key={standing.id} className={standing.id === network.playerId ? 'is-you' : ''}>
                <span>{standing.place}</span>
                <strong>{standing.name}<small>{standing.awards?.join(' · ')}</small></strong>
                <small>{standing.id === network.playerId ? 'YOU' : formatTime(standing.bestLapTime ?? null)}</small>
              </li>
            ))}
          </ol>
          {isHost ? <button className="primary-button" type="button" onClick={() => client.requestRematch()}>Race again <span aria-hidden="true">↻</span></button> : <p className="waiting-message">Waiting for the host to start a rematch…</p>}
          <button className="text-button" type="button" onClick={leave}>Back to race control</button>
        </section>
      )}

      {phase !== 'finished' && network.error && <div className="network-error" role="alert">{network.error}</div>}
      {itemNotice && <div className="item-notice" role="status">{itemNotice}</div>}
      {network.reaction && <div className="reaction-toast" role="status"><strong>{network.reaction.name}</strong> {reactionLabel(network.reaction.reaction)}</div>}
      {phase !== 'lobby' && <div className="quick-reactions" aria-label="Quick reactions"><button type="button" onClick={() => client.sendReaction('nice')}>NICE!</button><button type="button" onClick={() => client.sendReaction('oops')}>OOPS</button><button type="button" onClick={() => client.sendReaction('rematch')}>REMATCH?</button></div>}
      {phase !== 'finished' && <footer className="controls-bar"><span><kbd>{[bindings.accelerate, bindings.left, bindings.reverse, bindings.right].map(formatBinding).join(' / ')}</kbd> / <kbd>ARROWS</kbd> DRIVE</span>{phase !== 'lobby' && <><span><kbd>{formatBinding(bindings.brake)}</kbd> BRAKE</span><span><kbd>{formatBinding(bindings.reset)}</kbd> RESET</span></>}{phase !== 'lobby' && settings.itemsEnabled && <span><kbd>{formatBinding(bindings.item)}</kbd> ITEM</span>}<button className="controls-toggle" type="button" onClick={() => setShowControls(true)}>EDIT KEYS</button></footer>}
    </main>
  )
}

function TrackPreview({ trackId }: { trackId: string }) {
  const track = getTrack(trackId)
  const bounds = getTrackBounds(track)
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxZ - bounds.minZ)
  const scale = 80 / Math.max(width, height)
  const points = track.points.map((point) => `${50 + (point.x - (bounds.minX + bounds.maxX) / 2) * scale},${50 - (point.z - (bounds.minZ + bounds.maxZ) / 2) * scale}`).join(' ')

  return (
    <svg className="track-preview" viewBox="0 0 100 100" role="img" aria-label={`${track.name} circuit outline`}>
      <polygon className="track-preview-road" points={points} />
      <polygon className="track-preview-line" points={points} />
    </svg>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Plain HTTP network pages cannot use the modern clipboard API.
  }

  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.left = '-9999px'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  field.setSelectionRange(0, field.value.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}

function formatTime(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '--:--'
  return `${(milliseconds / 1_000).toFixed(2)}s`
}

function latestItemNotice(events: RaceEvent[], karts: KartSnapshot[], playerId: string, serverTime: number): string | null {
  const event = [...events].reverse().find((candidate) => {
    const concernsPlayer = candidate.playerId === playerId || candidate.targetId === playerId
    const isItemEvent = candidate.kind === 'item-pickup' || candidate.kind === 'item-used' || candidate.kind === 'item-hit' || candidate.kind === 'spin'
    return concernsPlayer && isItemEvent && serverTime - candidate.at < 1_700
  })
  if (!event) return null
  const item = event.item ? ITEM_INFO[event.item] : null
  if (event.kind === 'item-pickup' && event.playerId === playerId) return `PICKED UP ${item?.label ?? 'ITEM'} · ${item?.cue ?? 'ITEM READY'}`
  if (event.kind === 'item-used' && event.playerId === playerId) return `${item?.label ?? 'ITEM'} USED`
  if (event.kind === 'item-hit' && event.targetId === playerId) return `SHIELD BLOCKED ${item?.label ?? 'A HIT'}`
  if (event.kind === 'spin' && event.targetId === playerId) return `HIT BY ${item?.label ?? 'HAZARD'}`
  if (event.kind === 'spin' && event.playerId === playerId && event.targetId) {
    const target = karts.find((kart) => kart.id === event.targetId)
    return `${item?.label ?? 'ITEM'} HIT ${target?.name ?? 'RACER'}`
  }
  return null
}

function reactionLabel(reaction: 'nice' | 'oops' | 'rematch'): string {
  return reaction === 'nice' ? 'Nice!' : reaction === 'oops' ? 'Oops!' : 'Rematch?'
}

function bindingLabel(action: BindingAction): string {
  return action === 'accelerate' ? 'ACCELERATE' : action === 'reverse' ? 'REVERSE' : action.toUpperCase()
}

function formatBinding(code: string): string {
  return code.replace('Key', '').replace('Arrow', '').replace('Space', 'SPACE')
}

export default App
