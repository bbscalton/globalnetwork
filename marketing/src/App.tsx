import { useEffect, useState } from 'react'

const OPS = (import.meta.env.VITE_OPS_WEB_URL as string | undefined) || './ops/'
const POS = (import.meta.env.VITE_POS_WEB_URL as string | undefined) || './pos/'
const WEB_APP =
  (import.meta.env.VITE_CUSTOMER_WEB_URL as string | undefined) || './app/'
const APK =
  (import.meta.env.VITE_ANDROID_APK_URL as string | undefined) ||
  'https://globalnetwork-media.neuereatec.workers.dev/app/android.apk'
const DESK_APK =
  (import.meta.env.VITE_DESK_APK_URL as string | undefined) ||
  'https://globalnetwork-media.neuereatec.workers.dev/app/desk.apk'

const NAV = [
  ['#why', 'Why us'],
  ['#how', 'How it works'],
  ['#plans', 'Plans'],
  ['#account', 'My account'],
  ['#support', 'Support'],
] as const

function useReveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-reveal]')
    if (!nodes.length) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      nodes.forEach((el) => el.classList.add('is-visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-visible')
          io.unobserve(entry.target)
        }
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' },
    )
    nodes.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  useReveal()

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="page">
      <a className="skip" href="#top">
        Skip to content
      </a>

      <header className="nav">
        <a className="brand" href="#top" onClick={closeMenu}>
          <img src="./logo-gn.png" alt="" width={36} height={36} />
          GlobalNetwork
        </a>
        <nav className="nav-links" aria-label="Section navigation">
          {NAV.map(([href, label]) => (
            <a key={href} href={href} onClick={closeMenu}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-ctas">
          <a className="btn btn-ghost hide-sm" href={APK}>
            Download Android
          </a>
          <a className="btn btn-primary" href={WEB_APP}>
            Manage my service
          </a>
          <button
            className="menu-btn"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </header>

      <nav id="mobile-nav" className={`mobile-drawer ${menuOpen ? 'is-open' : ''}`} aria-label="Mobile">
        {NAV.map(([href, label]) => (
          <a key={href} href={href} onClick={closeMenu}>
            {label}
          </a>
        ))}
        <a className="btn btn-ghost" href={APK} onClick={closeMenu}>
          Download Android
        </a>
      </nav>

      <section id="top" className="hero">
        <div className="hero-media" style={{ backgroundImage: 'url(./hero-globe.png)' }} aria-hidden="true" />
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow eyebrow-on-dark">Internet · Antigua · billed in EC$ / XCD</p>
            <h1 className="hero-title">Antigua internet you can see, extend, and manage.</h1>
            <p className="hero-sub">
              GlobalNetwork puts days on your line. Pay a plan, watch days left, chat with the desk, and
              keep service on if you cannot pay the full fee yet.
            </p>
            <div className="hero-ctas">
              <a className="btn btn-primary btn-lg" href={WEB_APP}>
                Manage my service
              </a>
              <a className="btn btn-ghost-on-dark btn-lg" href={APK}>
                Download Android
              </a>
            </div>
            <p className="hero-note">
              The customer web app is the fastest way to check days, payments, and chat. Android is the
              same account on your phone.
            </p>
            <ul className="hero-pills" aria-label="Service highlights">
              <li>Serving Antigua</li>
              <li>East Caribbean dollars</li>
              <li>Chat from the app</li>
            </ul>
          </div>
          <div className="globe-stage" aria-hidden="true">
            <div className="globe-aura gn-pulse" />
            <div className="orbit orbit-a">
              <span className="gn-spin" />
            </div>
            <div className="orbit orbit-b">
              <span className="gn-spin" />
            </div>
            <img className="globe-mark" src="./logo-gn.png" alt="" width={280} height={280} />
          </div>
        </div>
      </section>

      <section id="why" className="section">
        <header className="section-head" data-reveal>
          <p className="eyebrow">Why GlobalNetwork</p>
          <h2>A local line with a live account — not a black box.</h2>
          <p className="muted lead">
            Built for Antigua households and shops that need to know what they have paid, how many days
            remain, and how to reach someone when the line is down.
          </p>
        </header>
        <div className="section-grid">
          {[
            ['Days you can see', 'Open the web app and read days left on the line. No guessing when service ends.'],
            ['Fair when money is tight', 'Cannot pay the full plan? Ask for more days. The rest goes on the next payment.'],
            ['Chat that stays with your account', 'Message the Antigua desk from the same place you pay and report faults.'],
            ['Photos of the problem', 'File a line issue with pictures so the desk can see what is on the pole or at the house.'],
          ].map(([title, body], i) => (
            <article key={title} className="glass-card" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
              <p className="card-index">{String(i + 1).padStart(2, '0')}</p>
              <h3>{title}</h3>
              <p className="muted" style={{ marginTop: '0.5rem' }}>
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="section">
        <header className="section-head" data-reveal>
          <p className="eyebrow">How it works</p>
          <h2>Pay. Days go on the line. Extend if you need to.</h2>
        </header>
        <ol className="steps">
          {[
            ['Choose a plan', '15, 30, or 90 days, billed in EC$. The desk records the payment against your account.'],
            ['Service days start', 'Your line stays on through the days you paid. Watch the countdown in Manage my service.'],
            ['Need more time?', 'If the full fee is not ready, ask the desk to extend days. Remaining balance waits for the next payment.'],
            ['Talk from the app', 'Chat about billing, outages, or a photo of a fault — without hunting for a phone number.'],
          ].map(([title, body], i) => (
            <li key={title} className="glass-card step-card" data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
              <span className="step-num">{i + 1}</span>
              <h3>{title}</h3>
              <p className="muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="plans" className="section">
        <header className="section-head" data-reveal>
          <p className="eyebrow">Plans</p>
          <h2>15 / 30 / 90 days in East Caribbean dollars</h2>
          <p className="muted lead">Starter packages. Ask in chat if you need a mix of days or an extension.</p>
        </header>
        <div className="plan-grid">
          <article className="glass-card plan-card" data-reveal>
            <p className="eyebrow">Starter</p>
            <h3>15 days</h3>
            <p className="plan-price">EC$2,200</p>
            <p className="muted">Short cycle when you want a smaller outlay.</p>
          </article>
          <article className="glass-card plan-card plan-featured" data-reveal>
            <p className="eyebrow">Most used</p>
            <h3>30 days</h3>
            <p className="plan-price">EC$4,000</p>
            <p className="muted">A full month on the line, billed in XCD.</p>
            <a className="btn btn-primary" href={WEB_APP}>
              Manage my service
            </a>
          </article>
          <article className="glass-card plan-card" data-reveal>
            <p className="eyebrow">Best value</p>
            <h3>90 days</h3>
            <p className="plan-price">EC$10,800</p>
            <p className="muted">Three months prepaid — fewer renewals to remember.</p>
          </article>
        </div>
      </section>

      <section id="account" className="section">
        <header className="section-head" data-reveal>
          <p className="eyebrow">Manage your account</p>
          <h2>Days left, payments, and chat — in one place.</h2>
          <p className="muted lead">
            The customer web app is the main self-service path. Sign in with Google or email. Android uses
            the same account.
          </p>
        </header>
        <div className="account-grid">
          <article className="glass-card account-feature" data-reveal>
            <p className="eyebrow">Primary</p>
            <h3>Customer web app</h3>
            <ul className="check-list">
              <li>See days left on the line</li>
              <li>Read payment history</li>
              <li>Chat with the Antigua desk</li>
              <li>Open an issue and attach photos</li>
            </ul>
            <a className="btn btn-primary btn-lg" href={WEB_APP}>
              Manage my service
            </a>
          </article>
          <div className="account-side">
            <article className="glass-card" data-reveal>
              <h3>Customer Android</h3>
              <p className="muted">
                Same subscriber app on a 64-bit phone. Install the APK, allow this one install if Android
                asks, and sign in. Uninstall an older customer GlobalNetwork app first if the update is
                blocked.
              </p>
              <a className="btn btn-ghost" href={APK} style={{ marginTop: '1rem' }}>
                Download Android
              </a>
            </article>
            <article className="glass-card" data-reveal>
              <h3>Not the staff app</h3>
              <p className="muted">
                Customers use the web app or the customer Android APK. The owner desk is a separate tool
                for neuereatec staff — linked quietly in the footer.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="support" className="section">
        <header className="section-head" data-reveal>
          <p className="eyebrow">Support</p>
          <h2>Chat from the app. We pick it up in Antigua.</h2>
          <p className="muted lead">
            There is no separate public hotline on this page. Open a conversation on your account so the
            desk sees who you are, the days on your line, and any photos you send.
          </p>
        </header>
        <div className="section-grid">
          <article className="glass-card" data-reveal>
            <h3>Chat from the app</h3>
            <p className="muted">
              Message the owner desk from Manage my service or the Android app. That is the supported way
              to reach GlobalNetwork.
            </p>
          </article>
          <article className="glass-card" data-reveal>
            <h3>Line issues with photos</h3>
            <p className="muted">
              Report a downed line, power, or indoor fault and attach pictures. The desk reviews them with
              your account.
            </p>
          </article>
          <article className="glass-card" data-reveal>
            <h3>Call or video in the app</h3>
            <p className="muted">
              Voice and video are available as a best-effort option inside the customer app when the desk
              is on a live session. Start from chat if you need that.
            </p>
          </article>
        </div>
        <p className="support-meta" data-reveal>
          Area: Antigua · Desk timezone: America/Antigua · Owner: neuereatec@gmail.com
        </p>
      </section>

      <section id="download" className="section download-band">
        <header className="section-head" data-reveal>
          <p className="eyebrow">Get the app</p>
          <h2>Web first. Android if you want it on the phone.</h2>
        </header>
        <div className="download-grid">
          <article className="glass-card download-primary" data-reveal>
            <p className="eyebrow">Customers</p>
            <h3>Manage my service</h3>
            <p className="muted">
              Browser app on this site. Check days, pay history, chat, and issues — no install required.
            </p>
            <a className="btn btn-primary btn-lg" href={WEB_APP}>
              Open customer web app
            </a>
          </article>
          <article className="glass-card" data-reveal>
            <p className="eyebrow">Customers</p>
            <h3>Android APK</h3>
            <p className="muted">Subscriber app for Android phones. Not the owner desk.</p>
            <a className="btn btn-ghost" href={APK}>
              Download customer Android
            </a>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-brand">
          <img src="./logo-gn.png" alt="" width={40} height={40} />
          <div>
            <strong>GlobalNetwork</strong>
            <p>Antigua internet · billed in EC$ / XCD</p>
          </div>
        </div>
        <div className="footer-cols">
          <div>
            <p className="footer-label">Customers</p>
            <a href={WEB_APP}>Manage my service</a>
            <a href={APK}>Download Android</a>
            <a href="#support">Support</a>
            <a href="#plans">Plans</a>
          </div>
          <div>
            <p className="footer-label">Staff</p>
            <a href={OPS}>Open owner desk</a>
            <a href={POS}>Field POS</a>
            <a href={DESK_APK}>Download owner desk Android</a>
            <p className="muted small">For neuereatec / approved desk owners only. Not a customer download.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
