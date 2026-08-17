import { useEffect, useMemo, useRef, useState } from 'react'
import type { Customer, VoiceCall } from './lib/types'
import * as repo from './lib/repo'
import { createAudioPeer, mixCallRecorder, remoteStreamOf, stopStream, type MixRecorder } from './lib/webrtc'
import { initials } from './lib/desk'

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

type LiveSession = {
  customerId: string
  callId: string
  name: string
}

function startRing(): () => void {
  let ctx: AudioContext | null = null
  const beep = () => {
    ctx = ctx ?? new AudioContext()
    void ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 864
    gain.gain.value = 0.04
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.28)
  }
  beep()
  const id = window.setInterval(beep, 1400)
  return () => {
    window.clearInterval(id)
    void ctx?.close()
  }
}

export function CallOverlay({ customers }: { customers: Customer[] }) {
  const ringing = useMemo(
    () => customers.filter((c) => c.callStatus === 'ringing' && c.liveCallId),
    [customers],
  )
  const [session, setSession] = useState<LiveSession | null>(null)
  const [call, setCall] = useState<VoiceCall | null>(null)
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'in_call'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const incoming = !session && ringing[0] ? ringing[0] : null

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const remoteEl = useRef<HTMLAudioElement | null>(null)
  const mixerRef = useRef<MixRecorder | null>(null)
  const recordStartedRef = useRef(0)
  const iceSeen = useRef(new Set<string>())
  const waitingIce = useRef<RTCIceCandidateInit[]>([])
  const iceUnsub = useRef<(() => void) | null>(null)
  const closingRef = useRef(false)
  const sessionRef = useRef<LiveSession | null>(null)
  sessionRef.current = session

  useEffect(() => {
    if (!incoming) return
    return startRing()
  }, [incoming?.id, incoming?.liveCallId])

  useEffect(() => {
    if (phase !== 'in_call') {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const id = window.setInterval(() => setElapsed(Date.now() - started), 500)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => {
    if (!session) return
    return repo.observeCall(session.customerId, session.callId, (row) => {
      setCall(row)
      if (!row || row.status === 'ended' || row.status === 'missed') {
        void teardown(false)
      }
    })
  }, [session?.customerId, session?.callId])

  const teardown = async (notifyRemote: boolean) => {
    if (closingRef.current) return
    closingRef.current = true
    const live = sessionRef.current
    const rec = mixerRef.current
    mixerRef.current = null
    if (rec && live) {
      setSaving(true)
      try {
        const blob = await rec.stop()
        if (blob.size > 400) {
          await repo.saveCallRecording(live.customerId, live.callId, blob, Date.now() - (recordStartedRef.current || Date.now()))
        }
      } catch {
        // Keep hangup even if the archive upload fails.
      } finally {
        setSaving(false)
      }
    }
    pcRef.current?.close()
    pcRef.current = null
    stopStream(localRef.current)
    localRef.current = null
    iceSeen.current.clear()
    waitingIce.current = []
    iceUnsub.current?.()
    iceUnsub.current = null
    if (remoteEl.current) remoteEl.current.srcObject = null
    if (notifyRemote && live) {
      await repo.hangupCall(live.customerId, live.callId, 'owner', call?.status === 'ringing' ? 'missed' : 'ended').catch(() => undefined)
    }
    setRecording(false)
    setMuted(false)
    setPhase('idle')
    setSession(null)
    setCall(null)
  }

  const answer = async (customer: Customer) => {
    const callId = customer.liveCallId
    if (!callId || phase === 'connecting') return
    setError(null)
    setPhase('connecting')
    closingRef.current = false
    setSession({ customerId: customer.id, callId, name: customer.name || customer.phone || 'Customer' })
    try {
      const iceServers = await repo.fetchIceServers()
      const { pc, local } = await createAudioPeer(iceServers)
      pcRef.current = pc
      localRef.current = local
      pc.onicecandidate = (event) => {
        const ice = event.candidate
        if (!ice?.candidate) return
        void repo.addIceCandidate(customer.id, callId, 'iceAnswer', {
          candidate: ice.candidate,
          sdpMid: ice.sdpMid,
          sdpMLineIndex: ice.sdpMLineIndex,
        })
      }
      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track])
        if (remoteEl.current) {
          remoteEl.current.srcObject = stream
          void remoteEl.current.play().catch(() => undefined)
        }
      }
      iceSeen.current.clear()
      iceUnsub.current?.()
      iceUnsub.current = repo.observeIce(customer.id, callId, 'iceOffer', (row) => {
        if (iceSeen.current.has(row.id) || !row.candidate) return
        iceSeen.current.add(row.id)
        const init: RTCIceCandidateInit = {
          candidate: row.candidate,
          sdpMid: row.sdpMid ?? undefined,
          sdpMLineIndex: row.sdpMLineIndex ?? undefined,
        }
        if (!pc.remoteDescription) {
          waitingIce.current.push(init)
          return
        }
        void pc.addIceCandidate(init).catch(() => undefined)
      })
      let offer = ''
      for (let i = 0; i < 20 && !offer; i += 1) {
        const row = await repo.getCall(customer.id, callId)
        offer = row?.offerSdp ?? ''
        if (!offer) await new Promise((r) => window.setTimeout(r, 200))
      }
      if (!offer) throw new Error('The call offer never arrived.')
      await pc.setRemoteDescription({ type: 'offer', sdp: offer })
      for (const pending of waitingIce.current) {
        await pc.addIceCandidate(pending).catch(() => undefined)
      }
      waitingIce.current = []
      const answerSdp = await pc.createAnswer()
      await pc.setLocalDescription(answerSdp)
      await repo.answerCall(customer.id, callId, answerSdp.sdp || '')
      setPhase('in_call')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer the call.')
      setPhase('idle')
      setSession(null)
      pcRef.current?.close()
      stopStream(localRef.current)
      pcRef.current = null
      localRef.current = null
    }
  }

  const decline = async (customer: Customer) => {
    if (!customer.liveCallId) return
    await repo.hangupCall(customer.id, customer.liveCallId, 'owner', 'missed').catch(() => undefined)
  }

  const toggleMute = () => {
    const next = !muted
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next
    })
    setMuted(next)
  }

  const toggleRecord = async () => {
    if (!session || phase !== 'in_call') return
    if (recording) {
      const rec = mixerRef.current
      mixerRef.current = null
      setRecording(false)
      await repo.setCallRecording(session.customerId, session.callId, false).catch(() => undefined)
      if (rec) {
        setSaving(true)
        try {
          const blob = await rec.stop()
          if (blob.size > 400) {
            await repo.saveCallRecording(session.customerId, session.callId, blob, Date.now() - recordStartedRef.current)
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save the recording.')
        } finally {
          setSaving(false)
        }
      }
      return
    }
    const pc = pcRef.current
    const local = localRef.current
    if (!pc || !local) return
    const mixer = mixCallRecorder(local, remoteStreamOf(pc))
    mixer.start()
    mixerRef.current = mixer
    recordStartedRef.current = Date.now()
    setRecording(true)
    await repo.setCallRecording(session.customerId, session.callId, true).catch(() => undefined)
  }

  if (!incoming && !session) return <audio ref={remoteEl} autoPlay playsInline hidden />

  return (
    <>
      <audio ref={remoteEl} autoPlay playsInline hidden />
      {incoming && (
        <div className="call-toast incoming gn-pulse" role="alertdialog" aria-label="Incoming voice call">
          <span className="avatar">{initials(incoming.name)}</span>
          <div>
            <p className="eyebrow">Incoming voice call</p>
            <strong>{incoming.name || incoming.phone || 'Customer'}</strong>
            <div className="muted tiny">{incoming.planName || 'No plan'} · {incoming.phone || 'In-app VoIP'}</div>
            {error && <p className="fail tiny">{error}</p>}
          </div>
          <div className="call-actions">
            <button className="btn btn-ghost" type="button" onClick={() => void decline(incoming)}>
              Decline
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void answer(incoming)}>
              Answer
            </button>
          </div>
        </div>
      )}
      {session && (
        <div className={`call-toast live ${recording ? 'is-rec' : ''}`}>
          <span className="avatar">{initials(session.name)}</span>
          <div>
            <p className="eyebrow">{phase === 'connecting' ? 'Connecting' : recording ? 'Recording this call' : 'Live voice call'}</p>
            <strong>{session.name}</strong>
            <div className="muted tiny">{phase === 'in_call' ? clock(elapsed) : 'Opening the line…'}{saving ? ' · saving recording' : ''}</div>
            {error && <p className="fail tiny">{error}</p>}
          </div>
          <div className="call-actions">
            <button className="btn btn-ghost" type="button" disabled={phase !== 'in_call'} onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              className={`btn ${recording ? 'danger' : 'btn-ghost'}`}
              type="button"
              disabled={phase !== 'in_call' || saving}
              onClick={() => void toggleRecord()}
            >
              {recording ? 'Stop record' : 'Record'}
            </button>
            <button className="btn danger" type="button" onClick={() => void teardown(true)}>
              Hang up
            </button>
          </div>
        </div>
      )}
    </>
  )
}
