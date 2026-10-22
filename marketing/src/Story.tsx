import { useCallback, useEffect, useRef, useState } from 'react'

type Fx = 'antenna' | 'beam' | 'phones' | 'walk' | 'stream' | 'chat' | 'play' | 'social'
type Scene = { img: string; alt: string; tag: string; pic: string; fx: Fx }

const SCENES: Scene[] = [
  { img: 'install', fx: 'antenna', tag: 'Up it goes',
    alt: 'Manga illustration: a technician on a ladder fixes a small white antenna to a colourful Antiguan cottage above a turquoise harbour at sunset.',
    pic: 'a small white antenna clicks onto your roof, facing the tower on the hill.' },
  { img: 'rooftops', fx: 'beam', tag: 'Signal lands',
    alt: 'Manga illustration: hillside village of pastel island cottages with rooftop antennas above a harbour with sailboats at dusk.',
    pic: 'a line of light skips over the harbour and lands on your rooftop.' },
  { img: 'phones', fx: 'phones', tag: 'Lights on',
    alt: 'Manga illustration: several hands hold phones whose screens glow bright turquoise among sparkling connection lines.',
    pic: 'you pay a plan, and the days show up on your line, counting down where you can see them.' },
  { img: 'town', fx: 'walk', tag: 'Out in town',
    alt: 'Manga illustration: smiling people walk a sunny island street of colourful wooden houses by the sea, looking at their phones.',
    pic: 'a quick look at days left while you walk down the street by the water.' },
  { img: 'home', fx: 'stream', tag: 'Movie night',
    alt: 'Manga illustration: a family of five on a sofa watching a movie of a moonlit beach on the TV.',
    pic: 'movie night on the sofa, and nobody has to guess when service ends.' },
  { img: 'business', fx: 'chat', tag: 'Shop open',
    alt: 'Manga illustration: a shopkeeper at a wooden counter works on a laptop and phone in a small island shop.',
    pic: 'the shop line acts up, you snap a photo, and the desk sees it next to your account.' },
  { img: 'kids', fx: 'play', tag: 'Game on',
    alt: 'Manga illustration: two excited kids play on tablets on a bed, with sparkles in the air and the sea outside the window.',
    pic: '“Five more minutes!” You ask the desk for a day extension right in chat.' },
  { img: 'social', fx: 'social', tag: 'Share it',
    alt: 'Manga illustration: three friends on a seawall take a selfie and share photos as the sun sets over the sea.',
    pic: 'sunset on the seawall, and the photos are shared before the sun goes down.' },
]

const DURATION = 6500

function FxLayer({ fx }: { fx: Fx }) {
  switch (fx) {
    case 'antenna':
      return (
        <>
          <span className="fx-antenna" style={{ left: '77%', top: '15%' }} />
          {[0, 1, 2].map((i) => (
            <span key={i} className="fx-arc" style={{ left: '78%', top: '18%', animationDelay: `${0.9 + i * 0.45}s` }} />
          ))}
          <span className="fx-ping" style={{ left: '45%', top: '33%' }} />
        </>
      )
    case 'beam':
      return (
        <svg className="fx-svg" viewBox="0 0 100 56.25" preserveAspectRatio="none" aria-hidden="true">
          {[
            'M83 12 Q 55 2 21 39',
            'M83 12 Q 70 18 70 49',
            'M83 12 Q 45 12 29 43',
            'M83 12 Q 90 25 67 47',
          ].map((d, i) => (
            <g key={d}>
              <path d={d} className="beam-track" />
              <path d={d} className="beam-pulse" style={{ animationDelay: `${0.3 + i * 0.5}s` }} />
            </g>
          ))}
          <circle cx="83" cy="12" r="1.2" className="beam-src" />
        </svg>
      )
    case 'phones':
      return (
        <>
          {[[30, 23], [65, 28], [30, 60], [53, 66], [76, 63]].map(([x, y], i) => (
            <span key={i} className="fx-glow" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${0.2 + i * 0.35}s` }} />
          ))}
          <span className="fx-chip" style={{ left: '50%', top: '12%' }}>Days left ▲</span>
        </>
      )
    case 'walk':
      return (
        <>
          {[[19, 43], [33, 46], [84, 46]].map(([x, y], i) => (
            <span key={i} className="fx-wifi" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${0.4 + i * 0.5}s` }} />
          ))}
        </>
      )
    case 'stream':
      return (
        <>
          <span className="fx-play" style={{ left: '79%', top: '40%' }} />
          <span className="fx-bar" style={{ left: '72%', top: '55%' }} />
        </>
      )
    case 'chat':
      return (
        <>
          <span className="fx-bubble" style={{ left: '62%', top: '22%', animationDelay: '0.6s' }}>📷</span>
          <span className="fx-bubble fx-bubble-r" style={{ left: '72%', top: '36%', animationDelay: '1.6s' }}>✓ Seen</span>
          <span className="fx-ping" style={{ left: '58%', top: '50%' }} />
        </>
      )
    case 'play':
      return (
        <>
          {['★', '✦', '♥', '✦', '★'].map((c, i) => (
            <span key={i} className="fx-pop" style={{ left: `${30 + i * 10}%`, top: `${22 + (i % 2) * 10}%`, animationDelay: `${0.3 + i * 0.4}s` }}>{c}</span>
          ))}
          <span className="fx-bubble" style={{ left: '50%', top: '8%', animationDelay: '2.4s' }}>+1 day</span>
        </>
      )
    case 'social':
      return (
        <>
          {['♥', '👍', '💬', '♥', '♥'].map((c, i) => (
            <span key={i} className="fx-float" style={{ left: `${10 + i * 15}%`, top: '30%', animationDelay: `${0.3 + i * 0.5}s` }}>{c}</span>
          ))}
        </>
      )
  }
}

export default function Story() {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduce, setReduce] = useState(false)
  const [visible, setVisible] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const startX = useRef<number | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(mq.matches)
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const go = useCallback((d: number) => setIdx((i) => (i + d + SCENES.length) % SCENES.length), [])

  const playing = !paused && !reduce && visible
  useEffect(() => {
    if (!playing) return
    const t = window.setTimeout(() => go(1), DURATION)
    return () => window.clearTimeout(t)
  }, [playing, idx, go])

  return (
    <div
      ref={rootRef}
      className={`story${playing ? ' is-playing' : ''}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="How GlobalNetwork reaches you, in pictures"
      tabIndex={0}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1)
        if (e.key === 'ArrowLeft') go(-1)
      }}
      onPointerDown={(e) => { startX.current = e.clientX }}
      onPointerUp={(e) => {
        if (startX.current == null) return
        const dx = e.clientX - startX.current
        startX.current = null
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="story-stage">
        {SCENES.map((s, i) => (
          <figure
            key={s.img}
            className={`story-frame${i === idx ? ' is-active' : ''}`}
            aria-hidden={i !== idx}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${SCENES.length}: ${s.tag}`}
          >
            <div className="story-art">
              <img
                src={`./story/${s.img}-1280.webp`}
                srcSet={`./story/${s.img}-720.webp 720w, ./story/${s.img}-1280.webp 1280w`}
                sizes="(max-width: 980px) 100vw, 1100px"
                alt={s.alt}
                width={1280}
                height={720}
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                draggable={false}
              />
              {i === idx && (
                <div className="story-fx" aria-hidden="true">
                  <FxLayer fx={s.fx} />
                </div>
              )}
              <span className="story-tag">{String(i + 1).padStart(2, '0')} · {s.tag}</span>
            </div>
            {i === idx && (
              <figcaption className="story-cap" aria-live="polite">
                <b>Picture this:</b> {s.pic}
              </figcaption>
            )}
          </figure>
        ))}
        <button type="button" className="story-nav story-prev" onClick={() => go(-1)} aria-label="Previous scene">‹</button>
        <button type="button" className="story-nav story-next" onClick={() => go(1)} aria-label="Next scene">›</button>
      </div>
      <div className="story-dots" role="tablist" aria-label="Choose scene">
        {SCENES.map((s, i) => (
          <button
            key={s.img}
            type="button"
            role="tab"
            aria-selected={i === idx}
            aria-label={`Scene ${i + 1}: ${s.tag}`}
            className={`story-dot${i === idx ? ' is-active' : ''}`}
            onClick={() => setIdx(i)}
          >
            <span key={`${i}-${idx}`} style={{ animationDuration: `${DURATION}ms` }} />
          </button>
        ))}
      </div>
    </div>
  )
}
