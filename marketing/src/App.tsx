const OPS = (import.meta.env.VITE_OPS_WEB_URL as string | undefined) || './ops/'
const APK =
  (import.meta.env.VITE_ANDROID_APK_URL as string | undefined) ||
  'https://globalnetwork-media.neuereatec.workers.dev/app/android.apk'

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
          <a className="btn btn-ghost" href={APK}>
            Download Android app
          </a>
          <a className="btn btn-primary" href={OPS}>
            Owner desk
          </a>
        </div>
      </header>

      <section id="top" className="hero">
        <div className="hero-media" style={{ backgroundImage: 'url(./hero-globe.png)' }} aria-hidden="true" />
        <div className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <p className="eyebrow eyebrow-on-dark">Internet service · Antigua &amp; the Caribbean</p>
          <h1 className="hero-title">The world in your hands. Connection you can measure.</h1>
          <p className="hero-sub">
            GlobalNetwork tracks every customer subscription in real time — extend service by days when the
            full fee isn’t ready, chat from the field, and file line issues with photos.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary btn-lg" href={APK}>
              Download Android app
            </a>
            <a className="btn btn-ghost-on-dark btn-lg" href={OPS}>
              Open owner desk
            </a>
          </div>
        </div>
      </section>

      <section id="product" className="section">
        <p className="eyebrow">How it is built</p>
        <h2>Four live layers</h2>
        <p className="muted" style={{ maxWidth: 640, marginTop: '0.75rem' }}>
          Apps, Firebase, Cloudflare, and Hosting — running an ISP: subscriptions, grace days, R2 issue photos,
          and chat between the owner and each customer.
        </p>
        <div className="section-grid">
          {[
            ['1 · Apps', 'Owner web desk plus Flutter iOS & Android customer app.'],
            ['2 · Firebase', 'Auth, Firestore customers, Cloud Functions for extend-days, FCM alerts.'],
            ['3 · Cloudflare', 'Worker + R2 for issue photos, the Android APK download, D1 usage, and KV cache.'],
            ['4 · Hosting', 'GitHub Pages marketing site and owner desk; Firebase Hosting as an optional mirror.'],
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
        <p className="eyebrow">For the owner</p>
        <h2>Extend days when they don’t have the full fee</h2>
        <div className="section-grid">
          <article className="glass-card">
            <h3>Record a partial payment</h3>
            <p className="muted">Enter days granted and the amount paid. Status becomes grace until the rest arrives.</p>
          </article>
          <article className="glass-card">
            <h3>Realtime chat</h3>
            <p className="muted">Talk to the subscriber from the owner desk. Photos go to R2.</p>
          </article>
          <article className="glass-card">
            <h3>Issue photos</h3>
            <p className="muted">Customers upload line faults; the owner sees a live gallery from Cloudflare R2.</p>
          </article>
        </div>
      </section>

      <section id="plans" className="section">
        <p className="eyebrow">Starter packages</p>
        <h2>15 / 30 / 90 days</h2>
        <div className="section-grid">
          <article className="glass-card">
            <h3>15 days</h3>
            <p style={{ fontSize: '2rem', margin: '0.4rem 0' }}>EC$2,200</p>
          </article>
          <article className="glass-card">
            <h3>30 days</h3>
            <p style={{ fontSize: '2rem', margin: '0.4rem 0' }}>EC$4,000</p>
          </article>
          <article className="glass-card">
            <h3>90 days</h3>
            <p style={{ fontSize: '2rem', margin: '0.4rem 0' }}>EC$10,800</p>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        GlobalNetwork · Antigua · EC dollars · Download the Android app from Cloudflare R2
      </footer>
    </div>
  )
}
