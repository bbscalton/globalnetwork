const OPS = (import.meta.env.VITE_OPS_WEB_URL as string | undefined) || './ops/'
const WEB_APP =
  (import.meta.env.VITE_CUSTOMER_WEB_URL as string | undefined) || './app/'
const APK =
  (import.meta.env.VITE_ANDROID_APK_URL as string | undefined) ||
  'https://globalnetwork-media.neuereatec.workers.dev/app/android.apk'
const DESK_APK =
  (import.meta.env.VITE_DESK_APK_URL as string | undefined) ||
  'https://globalnetwork-media.neuereatec.workers.dev/app/desk.apk'
const IPA =
  (import.meta.env.VITE_IOS_IPA_URL as string | undefined) ||
  'https://github.com/bbscalton/globalnetwork/releases/latest/download/GlobalNetwork.ipa'
const TESTFLIGHT = (import.meta.env.VITE_IOS_TESTFLIGHT_URL as string | undefined)?.trim() || ''

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
          <a href="#download">Get the app</a>
          <a href="#owner-desk">Owner desk</a>
          <a href="#plans">Plans</a>
        </nav>
        <div className="nav-ctas">
          <a className="btn btn-ghost" href={WEB_APP}>
            Open web app
          </a>
          <a className="btn btn-ghost" href={APK}>
            Download customer app
          </a>
          <a className="btn btn-ghost" href={IPA}>
            Download iOS
          </a>
          <a className="btn btn-ghost" href={DESK_APK}>
            Download owner desk
          </a>
          <a className="btn btn-primary" href={OPS}>
            Open owner desk
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
            <a className="btn btn-primary btn-lg" href={WEB_APP}>
              Open web app
            </a>
            <a className="btn btn-ghost-on-dark btn-lg" href={APK}>
              Download customer app
            </a>
            <a className="btn btn-ghost-on-dark btn-lg" href={IPA}>
              Download iOS app
            </a>
            <a className="btn btn-ghost-on-dark btn-lg" href={DESK_APK}>
              Download owner desk
            </a>
            <a className="btn btn-ghost-on-dark btn-lg" href={OPS}>
              Open owner desk
            </a>
          </div>
          <p className="hero-note">
            Customers: use the web app or the customer Android APK. The owner desk APK is a separate app
            for neuereatec / desk owners only — it does not replace the customer APK.
          </p>
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
            ['1 · Apps', 'Owner web desk (and Desk Android TWA) plus Flutter customer app on web, Android, and iOS.'],
            ['2 · Firebase', 'Auth, Firestore customers, Cloud Functions for extend-days, FCM alerts.'],
            ['3 · Cloudflare', 'Worker + R2 for issue photos, customer and owner-desk APK downloads, D1 usage, and KV cache.'],
            ['4 · Hosting', 'GitHub Pages marketing site, owner desk, and customer web app; unsigned iOS IPA on GitHub Releases.'],
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

      <section id="download" className="section">
        <p className="eyebrow">Customer app</p>
        <h2>Open on the web, or download Android / iOS</h2>
        <p className="muted" style={{ maxWidth: 720, marginTop: '0.75rem' }}>
          Same Flutter app in the browser, on Android, and on iPhone. The web app is hosted on this site.
          Android can also install from the customer APK. This is not the owner desk. Apple does not allow a
          normal iPhone to sideload an IPA from a website — Settings will block it unless the build is signed
          and delivered through TestFlight or the App Store.
        </p>
        <div className="section-grid">
          <article className="glass-card">
            <h3>Web</h3>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Sign in with Google or email in the browser. Check days left, chat, payment history, and report
              line issues. Call and video are best-effort in the browser.
            </p>
            <a className="btn btn-primary" href={WEB_APP} style={{ marginTop: '1.1rem' }}>
              Open web app
            </a>
          </article>
          <article className="glass-card">
            <h3>Android (customer)</h3>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Customer app for subscribers. Tap the APK, open the file, and install. If Android asks, allow
              installs from the browser this one time. If an older customer GlobalNetwork app is already
              installed, uninstall it first, then install this file (64-bit phones).
            </p>
            <a className="btn btn-primary" href={APK} style={{ marginTop: '1.1rem' }}>
              Download customer APK
            </a>
          </article>
          <article className="glass-card">
            <h3>iPhone</h3>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Install on the phone with TestFlight when a public link is available. The IPA below is an
              unsigned CI build for Mac / Xcode / archival — it will not install like an APK on a stock
              iPhone.
            </p>
            <div className="download-actions">
              {TESTFLIGHT ? (
                <a className="btn btn-primary" href={TESTFLIGHT}>
                  Install on iPhone (TestFlight)
                </a>
              ) : (
                <p className="muted small">
                  TestFlight is not published yet. Ask the owner at neuereatec@gmail.com for an invite when
                  it is ready.
                </p>
              )}
              <a className="btn btn-ghost" href={IPA}>
                Download iOS IPA
              </a>
            </div>
          </article>
        </div>
      </section>

      <section id="owner-desk" className="section">
        <p className="eyebrow">Owner only</p>
        <h2>Download owner desk (Android)</h2>
        <p className="muted" style={{ maxWidth: 720, marginTop: '0.75rem' }}>
          GlobalNetwork Desk is a separate Android app for the Antigua owner desk — roster, chat, extend,
          settings. It is not the customer APK and can be installed beside it. The app is a Chrome Trusted
          Web Activity around the live desk at /ops/, so Google sign-in uses Chrome instead of a system
          WebView.
        </p>
        <div className="section-grid">
          <article className="glass-card">
            <h3>Android (owner desk)</h3>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Package name gn.globalnetwork.desk. Install on a 64-bit phone, allow unknown sources if asked,
              then sign in as neuereatec@gmail.com or another approved desk owner. Uninstall any previous
              Desk APK with this package name first if the installer blocks an update.
            </p>
            <div className="download-actions">
              <a className="btn btn-primary" href={DESK_APK}>
                Download owner desk APK
              </a>
              <a className="btn btn-ghost" href={OPS}>
                Open owner desk in browser
              </a>
            </div>
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
        GlobalNetwork · Antigua · EC dollars · Web app on GitHub Pages · Customer and owner-desk Android APKs
        on Cloudflare R2 · iOS IPA on GitHub Releases
      </footer>
    </div>
  )
}
