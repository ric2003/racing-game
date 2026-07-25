import { useEffect, useRef } from 'react'
import type { GameClient } from '../network/client.js'
import { INPUT_INTERVAL } from '../shared/constants.js'
import type { KartSnapshot, PendingInput, ServerMessage } from '../shared/protocol.js'
import { SnapshotBuffer } from './interpolation.js'
import { createInputController } from './input.js'
import { LocalPredictor } from './prediction.js'
import { createRaceScene, type RenderKart } from './scene.js'

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

  useEffect(() => {
    snapshotRef.current = snapshot
    bufferRef.current.push(snapshot.serverTime, snapshot.karts)
    const local = snapshot.karts.find((kart) => kart.id === playerId)
    if (local) predictorRef.current.reconcile(local, client.pendingAfter(local.lastProcessedSeq))
  }, [client, playerId, snapshot])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let scene: ReturnType<typeof createRaceScene>
    try {
      scene = createRaceScene(canvas, reducedMotion)
    } catch {
      const error = document.createElement('div')
      error.className = 'render-error'
      error.role = 'alert'
      error.textContent = 'WebGL is unavailable. Enable hardware acceleration in a modern browser to race.'
      canvas.parentElement?.append(error)
      return () => error.remove()
    }

    const input = createInputController(canvas, () => client.resetKart())
    const observer = new ResizeObserver(() => scene.resize())
    observer.observe(canvas)
    let previousTime = performance.now()
    let lastInputTime = previousTime - INPUT_INTERVAL * 1_000
    let currentInput: PendingInput = { seq: 0, throttle: 0, steer: 0, brake: 0 }

    scene.setAnimationLoop((time) => {
      const delta = Math.min(0.1, Math.max(0, (time - previousTime) / 1_000))
      previousTime = time
      const latest = snapshotRef.current
      if (latest.phase === 'racing') {
        const controls = input.read()
        if (time - lastInputTime >= INPUT_INTERVAL * 1_000) {
          currentInput = client.sendInput(controls)
          lastInputTime = time
        } else {
          currentInput = { ...controls, seq: currentInput.seq }
        }
        predictorRef.current.advance(delta, currentInput)
      }

      const karts: RenderKart[] = latest.karts.map((kart): KartSnapshot => {
        if (kart.id === playerId && predictorRef.current.state) {
          const predicted = predictorRef.current.state
          return { ...kart, ...predicted }
        }
        return bufferRef.current.sample(kart.id) ?? kart
      })
      const local = karts.find((kart) => kart.id === playerId)
      if (local) {
        local.correctionX = predictorRef.current.correctionX
        local.correctionZ = predictorRef.current.correctionZ
      }
      scene.render(karts, playerId, delta)
    })

    return () => {
      scene.setAnimationLoop(null)
      observer.disconnect()
      input.dispose()
      scene.dispose()
    }
  }, [client, playerId])

  return (
    <div className="game-canvas-shell">
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} aria-label="3D race track. Click, then use WASD or arrow keys to drive." />
    </div>
  )
}
