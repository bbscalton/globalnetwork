import { useEffect, useRef, useState } from 'react'
import { auth } from './lib/firebase'
import type { ChatMessage } from './lib/types'

function durationLabel(ms: number | undefined) {
  if (!ms || ms <= 0) return '0:00'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export function kindOf(m: Pick<ChatMessage, 'kind' | 'mediaUrl' | 'text' | 'lat'>): 'voice' | 'video' | 'text' | 'location' | 'call' {
  if (m.kind === 'location' || (m.lat != null && Number.isFinite(m.lat))) return 'location'
  if (m.kind === 'call') return 'call'
  if (m.kind === 'voice' || m.kind === 'video' || m.kind === 'text') return m.kind
  const url = (m.mediaUrl ?? '').toLowerCase()
  const text = (m.text ?? '').toLowerCase()
  if (!url) return 'text'
  if (url.includes('/calls/') || url.includes('.webm') || text.includes('call recording')) return 'call'
  if (url.includes('.mp4') || url.includes('video') || text.includes('video')) return 'video'
  if (url.includes('.m4a') || url.includes('audio') || url.includes('voice') || text.includes('voice')) return 'voice'
  return 'voice'
}

function barsFor(seed: string): number[] {
  let n = 0
  for (let i = 0; i < seed.length; i++) n = (n * 33 + seed.charCodeAt(i)) >>> 0
  return Array.from({ length: 28 }, (_, i) => {
    n = (n * 1103515245 + 12345) >>> 0
    const wave = 0.35 + 0.65 * Math.abs(Math.sin((i + 1) * 0.55 + (n % 17)))
    return Math.round(18 + (n % 70) * wave)
  })
}

export function useAuthMedia(url: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(url))

  useEffect(() => {
    let gone = false
    let objectUrl = ''
    if (!url) {
      setSrc(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const token = await auth?.currentUser?.getIdToken()
        const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (!gone) {
          setSrc(objectUrl)
          setLoading(false)
        }
      } catch {
        if (!gone) {
          setSrc(url)
          setLoading(false)
          setError(null)
        }
      }
    })()
    return () => {
      gone = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return { src, error, loading }
}

function VoicePlayer({ url, durationMs }: { url: string; durationMs?: number }) {
  const { src, loading, error } = useAuthMedia(url)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const bars = barsFor(url)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => {
      const dur = el.duration || durationMs || 0
      setElapsed(el.currentTime * 1000)
      setProgress(dur ? el.currentTime / (dur / 1000 > 1 ? el.duration : dur / 1000) : 0)
    }
    const tick = () => {
      if (!el.duration || Number.isNaN(el.duration)) {
        const dur = (durationMs || 1) / 1000
        setProgress(el.currentTime / dur)
        setElapsed(el.currentTime * 1000)
        return
      }
      setProgress(el.currentTime / el.duration)
      setElapsed(el.currentTime * 1000)
    }
    const onEnd = () => {
      setPlaying(false)
      setProgress(0)
      setElapsed(0)
    }
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', onEnd)
    el.addEventListener('pause', () => setPlaying(false))
    el.addEventListener('play', () => setPlaying(true))
    return () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('ended', onEnd)
      el.removeEventListener('timeupdate', onTime)
    }
  }, [src, durationMs])

  const toggle = () => {
    const el = audioRef.current
    if (!el || !src) return
    if (el.paused) void el.play()
    else el.pause()
  }

  if (loading) return <div className="media-skeleton">Loading voice note…</div>
  if (error && !src) return <p className="muted tiny">{error}</p>

  const shown = elapsed > 0 ? durationLabel(elapsed) : durationLabel(durationMs)

  return (
    <div className="voice-player">
      <audio ref={audioRef} src={src ?? url} preload="metadata" />
      <button className={`play-hit ${playing ? 'is-on' : ''}`} type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="wave" aria-hidden="true">
        {bars.map((h, i) => (
          <span
            key={`${h}-${i}`}
            className={playing && progress * bars.length >= i ? 'is-lit' : ''}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <span className="voice-time">{shown}</span>
    </div>
  )
}

function VideoPlayer({ url }: { url: string }) {
  const { src, loading } = useAuthMedia(url)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)

  const toggle = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  if (loading) return <div className="media-skeleton video">Loading video clip…</div>

  return (
    <>
      <div className={`video-stage ${playing ? 'is-playing' : ''}`}>
        <video
          ref={videoRef}
          className="chat-clip"
          controls={playing}
          playsInline
          preload="metadata"
          src={src ?? url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {!playing && (
          <button className="play-hit xl" type="button" onClick={toggle} aria-label="Play video">
            ▶
          </button>
        )}
        <button className="video-expand" type="button" onClick={() => setOpen(true)}>
          Expand
        </button>
      </div>
      {open && (
        <div className="media-lightbox" role="dialog" onClick={() => setOpen(false)}>
          <video className="lightbox-clip" controls autoPlay playsInline src={src ?? url} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

export function ChatBubbleBody({ m, customerId }: { m: ChatMessage; customerId?: string }) {
  const kind = kindOf(m)
  if (kind === 'voice' && m.mediaUrl) {
    return (
      <div className="media-block">
        <VoicePlayer url={m.mediaUrl} durationMs={m.durationMs} />
      </div>
    )
  }
  if (kind === 'call') {
    return (
      <div className="media-block">
        {m.mediaUrl ? <VoicePlayer url={m.mediaUrl} durationMs={m.durationMs} /> : <p>{m.text || 'Voice call'}</p>}
        {m.mediaUrl ? <p className="muted tiny">Call recording for this customer</p> : null}
      </div>
    )
  }
  if (kind === 'video' && m.mediaUrl) {
    return (
      <div className="media-block">
        <VideoPlayer url={m.mediaUrl} />
        {m.text && m.text.toLowerCase() !== 'video clip' ? <p>{m.text}</p> : null}
      </div>
    )
  }
  if (kind === 'location' && m.lat != null && m.lng != null) {
    const field = `${import.meta.env.BASE_URL}field${customerId ? `?c=${customerId}` : ''}`
    const nav = `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}`
    return (
      <div className="loc-card">
        <strong>{m.text || 'Shared location'}</strong>
        <p className="muted tiny">Pin on the field map for a technician.</p>
        <p>
          <a href={field}>Field map</a>
          {' · '}
          <a href={nav} target="_blank" rel="noreferrer">
            Navigate
          </a>
        </p>
      </div>
    )
  }
  if (!m.text || (kind !== 'text' && /^(voice note|video clip)$/i.test(m.text))) return null
  return <p>{m.text}</p>
}
