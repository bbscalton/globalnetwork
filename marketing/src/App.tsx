const OPS = (import.meta.env.VITE_OPS_WEB_URL as string | undefined) || './ops/'
const TCD = './tcd.html'

export default function App() {
  return (
    <div className="page">
      <header className="nav">
        <a className="brand" href="#top">
          <img src="./logo-gn.png" alt="" />
          GlobalNetwork
        </a>
        <nav className="nav-links" aria-label="Section navigation">
          <a href="#product">Service</a>
          <a href="#how">How it works</a>
          <a href="#plans">Plans</a>
        </nav>
        <div className="nav-ctas">
          <a className="btn btn-ghost" href={TCD}>
            TCD Ops
          </a>
          <a className="btn btn-primary" href={OPS}>
            Staff dashboard
          </a>
        </div>
      </header>

      <section id="top" className="hero">
        <div className="hero-media" style={{ backgroundImage: 'url(./hero-globe.png)' }} aria-hidden="true" />
        <div className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <p className="eyebrow eyebrow-on-dark">Internet service · Guyana &amp; beyond</p>
          <h1 className="hero-title">The world in your hands. Connection you can measure.</h1>
          <p className="hero-sub">
            GlobalNetwork tracks every customer subscription in real time — extend service by days when the
            full fee isn’t ready, chat from the field, and file line issues with photos.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary btn-lg" href={OPS}>
              Open staff dashboard
            </a>
            <a className="btn btn-ghost-on-dark btn-lg" href={TCD}>
              Live architecture
            </a>
          </div>
        </div>
      </section>

      <section id="product" className="section">
        <p className="eyebrow">SareChild Ops architecture</p>
        <h2>Four live layers</h2>
        <p className="muted" style={{ maxWidth: 640, marginTop: '0.75rem' }}>
          The same control-plane pattern used by SareChild TCD — Apps, Firebase, Cloudflare, Hosting — now
          running an ISP: subscriptions, grace days, R2 issue photos, and support chat.
        </p>
        <div className="section-grid">
          {[
            ['1 · Apps', 'Staff web, TCD console, Flutter iOS & Android customer app.'],
            ['2 · Firebase', 'Auth, Firestore customers, Cloud Functions for extend-days, FCM alerts.'],
            ['3 · Cloudflare', 'Worker + R2 for issue photos, D1 usage, KV cache at the edge.'],
            ['4 · Hosting', 'GitHub Pages marketing + TCD, Firebase Hosting for the staff workspace.'],
          ].map(([title, body]) => (
            <article key={title} className="glass-card">
              <h3>{title}</h3>
              <p className="muted" style={{ marginTop: '0.5rem' }}>
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="section">
        <p className="eyebrow">For the service provider</p>
        <h2>Extend days when they don’t have the full fee</h2>
        <div className="section-grid">
          <article className="glass-card">
            <h3>Record a partial payment</h3>
            <p className="muted">Enter days granted and the amount paid. Status becomes grace until the rest arrives.</p>
          </article>
          <article className="glass-card">
            <h3>Realtime chat</h3>
            <p className="muted">Talk to the subscriber from TCD or ops-web. Images go to R2.</p>
          </article>
          <article className="glass-card">
            <h3>Issue photos</h3>
            <p className="muted">Customers upload line faults; staff see a live gallery from Cloudflare R2.</p>
          </article>
        </div>
      </section>

      <section id="plans" className="section">
        <p className="eyebrow">Starter packages</p>
        <h2>15 / 30 / 90 days</h2>
        <div className="section-grid">
          <article className="glass-card">
            <h3>15 days</h3>
            <p style={{ fontSize: '2rem', margin: '0.4rem 0' }}>G$2,200</p>
          </article>
          <article className="glass-card">
            <h3>30 days</h3>
            <p style={{ fontSize: '2rem', margin: '0.4rem 0' }}>G$4,000</p>
          </article>
          <article className="glass-card">
            <h3>90 days</h3>
            <p style={{ fontSize: '2rem', margin: '0.4rem 0' }}>G$10,800</p>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        GlobalNetwork · TCD on GitHub Pages · staff dashboard on Firebase Hosting · R2 for media
      </footer>
    </div>
  )
}
