import { useEffect, useRef } from 'react'
import type { GameClient } from '../network/client.js'
import type { KartSnapshot, PendingInput, ServerMessage } from '../shared/protocol.js'
import { getTrack } from '../shared/track.js'
import { SnapshotBuffer } from './interpolation.js'
import { createInputController } from './input.js'
import { InputScheduler, smoothSteering } from './input-scheduler.js'
import { LocalPredictor } from './prediction.js'
import { createRaceScene, type RenderKart } from './scene.js'
import { RaceAudio } from './audio.js'

interface GameCanvasProps {
  client: GameClient
  playerId: string
  snapshot: Extract<ServerMessage, { type: 'snapshot' }>
}

export function GameCanvas({ client, playerId, snapshot }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const snapshotRef = useRef(snapshot)
  const predictorRef = useRef(new LocalPredictor())
  const bufferRef = useRef(new SnapshotBuffer())
  const audioRef = useRef<RaceAudio | null>(null)
  const lastEventRef = useRef(0)
  const lastPhaseRef = useRef(snapshot.phase)

  useEffect(() => {
    snapshotRef.current = snapshot
    bufferRef.current.push(snapshot.serverTime, snapshot.karts)
    if (audioRef.current) {
      if (snapshot.phase !== lastPhaseRef.current) audioRef.current.play(snapshot.phase === 'racing' ? 'go' : snapshot.phase === 'finished' ? 'finish' : 'countdown')
      for (const event of snapshot.events ?? []) {
        if (event.id <= lastEventRef.current) continue
        if (event.kind === 'item-pickup' && event.playerId === playerId) audioRef.current.play('pickup')
        if (event.kind === 'item-used' && event.playerId === playerId) audioRef.current.play('use')
        if (event.kind === 'boost' && event.playerId === playerId) audioRef.current.play('boost')
        if (event.kind === 'item-hit' && (event.playerId === playerId || event.targetId === playerId)) audioRef.current.play('hit')
        if (event.kind === 'spin' && (event.playerId === playerId || event.targetId === playerId)) audioRef.current.play('spin')
        lastEventRef.current = Math.max(lastEventRef.current, event.id)
      }
    }
    lastPhaseRef.current = snapshot.phase
    const local = snapshot.karts.find((kart) => kart.id === playerId)
    if (local) {
      predictorRef.current.reconcile(
        local,
        client.pendingAfter(local.lastProcessedSeq),
        getTrack(snapshot.settings?.trackId),
        snapshot.serverTime,
      )
    }
  }, [client, playerId, snapshot])

  useEffect(() => {
    if (snapshot.phase !== 'lobby' && snapshot.phase !== 'countdown' && snapshot.phase !== 'racing') return undefined
    const frame = window.requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [snapshot.phase])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let scene: ReturnType<typeof createRaceScene>
    try {
      scene = createRaceScene(canvas, reducedMotion, getTrack(snapshot.settings?.trackId))
    } catch {
      const error = document.createElement('div')
      error.className = 'render-error'
      error.role = 'alert'
      error.textContent = 'WebGL is unavailable. Enable hardware acceleration in a modern browser to race.'
      canvas.parentElement?.append(error)
      return () => error.remove()
    }

    const audio = new RaceAudio()
    audioRef.current = audio
    const activateAudio = () => audio.resume()
    canvas.addEventListener('pointerdown', activateAudio)

    const input = createInputController(canvas, () => client.resetKart())
    const focusDriving = () => {
      if (document.visibilityState === 'visible') canvas.focus({ preventScroll: true })
    }
    const focusFrame = window.requestAnimationFrame(focusDriving)
    window.addEventListener('focus', focusDriving)
    document.addEventListener('visibilitychange', focusDriving)
    const observer = new ResizeObserver(() => scene.resize())
    observer.observe(canvas)
    let previousTime = performance.now()
    const inputScheduler = new InputScheduler()
    let currentInput: PendingInput = { seq: 0, throttle: 0, steer: 0, brake: 0 }
    let pendingUseItem = false
    let smoothedSteering = 0

    scene.setAnimationLoop((time) => {
      const delta = Math.min(0.1, Math.max(0, (time - previousTime) / 1_000))
      previousTime = time
      const latest = snapshotRef.current
      if (latest.phase === 'racing' || latest.phase === 'lobby') {
        const rawControls = input.read()
        smoothedSteering = smoothSteering(smoothedSteering, rawControls.steer, delta)
        const controls = { ...rawControls, steer: smoothedSteering }
        pendingUseItem = latest.phase === 'racing' && (pendingUseItem || input.consumeItem())
        const samples = inputScheduler.takeSamples(delta)
        for (let sample = 0; sample < samples; sample += 1) {
          currentInput = client.sendInput({ ...controls, useItem: latest.phase === 'racing' && pendingUseItem })
          pendingUseItem = false
        }
        predictorRef.current.advance(delta, currentInput)
      }

      const karts: RenderKart[] = latest.karts.map((kart): KartSnapshot => {
        if (kart.id === playerId && predictorRef.current.state) {
          const predicted = predictorRef.current.renderState ?? predictorRef.current.state
          return { ...kart, ...predicted }
        }
        return bufferRef.current.sample(kart.id) ?? kart
      })
      const local = karts.find((kart) => kart.id === playerId)
      if (local) {
        local.correctionX = predictorRef.current.correctionX
        local.correctionZ = predictorRef.current.correctionZ
        local.correctionHeading = predictorRef.current.correctionHeading
      }
      const spectatorTarget = local !== undefined && (local.finishedAt !== null || local.eliminated)
        ? latest.standings.find((standing) => !standing.eliminated && standing.id !== playerId)?.id ?? playerId
        : playerId
      scene.render(karts, playerId, delta, spectatorTarget, latest)
    })

    return () => {
      scene.setAnimationLoop(null)
      observer.disconnect()
      input.dispose()
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('focus', focusDriving)
      document.removeEventListener('visibilitychange', focusDriving)
      scene.dispose()
      canvas.removeEventListener('pointerdown', activateAudio)
      audio.dispose()
      audioRef.current = null
    }
  }, [client, playerId, snapshot.settings?.trackId])

  return (
    <div className="game-canvas-shell">
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} autoFocus aria-label="3D race track. Use WASD or arrow keys to drive." />
    </div>
  )
}
