import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { FirebaseError } from 'firebase/app'
import { useAuth } from './authContext'
import { ArchitectureTree, buildArchNodes } from './ArchitectureTree'
import { AccountsPanel } from './AccountsPanel'
import { PlansPanel } from './PlansPanel'
import { IssuesPanel } from './IssuesPanel'
import { ChatPanel } from './ChatPanel'
import { StoragePanel } from './StoragePanel'
import { SystemPanel } from './SystemPanel'
import { MARKETING_URL, OPS_WEB_URL, TCD_URL } from './firebase'
import * as repo from './repo'
import type {
  Customer,
  IssueTicket,
  Plan,
  PlatformFault,
  SiteUptime,
  TcdCheck,
  TcdCheckStatus,
  TcdReport,
  TcdTab,
} from './types'

const STATUS_RANK: Record<TcdCheckStatus, number> = { ok: 0, warn: 1, fail: 2 }

function worst(statuses: TcdCheckStatus[]): TcdCheckStatus | null {
  if (statuses.length === 0) return null
  return statuses.reduce((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc))
}

function timeAgo(ms: number | null | undefined): string {
  if (!ms) return 'never'
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function TcdApp() {
  const { configured, user, loading, isAdmin, isStaff, blockedMessage, orgId, signIn, signInWithGoogle, signOut } =
    useAuth()

  if (!configured) {
    return (
      <div className="tcd-auth-wrap">
        <div className="tcd-auth-card">
          <p className="eyebrow eyebrow-on-dark">GlobalNetwork Ops</p>
          <h1>TCD not configured</h1>
          <p className="muted on-dark">
            This build is missing Firebase environment variables. Set the VITE_FIREBASE_* secrets and redeploy.
          </p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="tcd-loading">Loading TCD console…</div>

  if (!user) return <TcdLogin signIn={signIn} signInWithGoogle={signInWithGoogle} />

  if (blockedMessage) {
    return (
      <div className="tcd-auth-wrap">
        <div className="tcd-auth-card">
          <p className="eyebrow eyebrow-on-dark">GlobalNetwork Ops</p>
          <h1>Account suspended</h1>
          <p className="muted on-dark">{blockedMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <TcdDashboard
      email={user.email || ''}
      isAdmin={isAdmin}
      isStaff={isStaff}
      orgId={orgId}
      signOut={signOut}
    />
  )
}

function TcdLogin({
  signIn,
  signInWithGoogle,
}: {
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const onGoogle = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'auth/account-exists-with-different-credential') {
        setError('This email already has a password account — sign in with email + password instead.')
      } else {
        setError(err instanceof Error ? err.message : 'Google sign-in failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tcd-auth-wrap">
      <form className="tcd-auth-card" onSubmit={(e) => void onSubmit(e)}>
        <img src="./logo-gn.png" alt="GlobalNetwork" className="tcd-logo-mark" />
        <div>
          <p className="eyebrow eyebrow-on-dark">GlobalNetwork Ops</p>
          <h1>TCD Control Plane</h1>
          <p className="muted on-dark small" style={{ marginTop: '0.5rem' }}>
            Sign in with your GlobalNetwork staff account. Project owner ({'neuereatec@gmail.com'}) gets full admin.
          </p>
        </div>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn btn-ghost-on-dark" type="button" disabled={busy} onClick={() => void onGoogle()}>
          Continue with Google
        </button>
      </form>
    </div>
  )
}

function TcdDashboard({
  email,
  isAdmin,
  isStaff,
  orgId,
  signOut,
}: {
  email: string
  isAdmin: boolean
  isStaff: boolean
  orgId: string | null
  signOut: () => Promise<void>
}) {
  const [tab, setTab] = useState<TcdTab>('overview')
  const [archSelected, setArchSelected] = useState<string | null>(null)
  const [report, setReport] = useState<TcdReport | null>(null)
  const [siteUptime, setSiteUptime] = useState<SiteUptime[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [issues, setIssues] = useState<IssueTicket[]>([])
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [repairLog, setRepairLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [lastRunMs, setLastRunMs] = useState<number | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!orgId) return
    const unsubs = [
      repo.observeCustomers(orgId, setCustomers, (e) => setError(e.message)),
      repo.observePlans(setPlans, (e) => setError(e.message)),
      repo.observeIssues(setIssues),
    ]
    return () => unsubs.forEach((u) => u())
  }, [orgId])

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const [nextReport, uptime] = await Promise.all([repo.runTcdHealthCheck(), repo.loadSiteUptime()])
      setReport(nextReport)
      setSiteUptime(uptime)
      setLastRunMs(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run TCD checks')
    } finally {
      setBusy(false)
    }
  }

  const runRepair = async () => {
    setBusy(true)
    setError(null)
    try {
      setRepairLog(await repo.runAutoRepair())
      await run()
      setStatusMsg('Auto-repair completed and health re-checked.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run auto-repair')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void run()
    const id = window.setInterval(() => void run(), 60_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const pulse = useMemo(() => {
    const due3 = customers.filter((c) => {
      const left = repo.daysLeft(c.paidUntilMs, nowTick)
      return left > 0 && left <= 3
    }).length
    const openChat = customers.filter((c) => (c.unreadStaff ?? 0) > 0).length
    const balance = customers.reduce((s, c) => s + (c.balanceDue || 0), 0)
    return {
      total: customers.length,
      active: customers.filter((c) => c.status === 'active').length,
      grace: customers.filter((c) => c.status === 'grace').length,
      expired: customers.filter((c) => c.status === 'expired' || c.status === 'suspended').length,
      due3,
      openChat,
      balance,
      openIssues: issues.filter((i) => i.status !== 'resolved').length,
    }
  }, [customers, issues, nowTick])

  const overallStatus = useMemo<TcdCheckStatus | 'checking'>(() => {
    if (!report) return 'checking'
    return worst([...report.checks.map((c) => c.status), ...siteUptime.map((s) => s.status)]) ?? 'ok'
  }, [report, siteUptime])

  const statusCopy: Record<TcdCheckStatus | 'checking', { title: string; sub: string }> = {
    checking: { title: 'Checking systems…', sub: 'Running the first diagnostic sweep now.' },
    ok: { title: 'All systems nominal', sub: 'Every monitored service is healthy across Firebase and the Cloudflare edge.' },
    warn: { title: 'Degraded — attention needed', sub: 'One or more checks need a look. See action items below.' },
    fail: { title: 'Critical — action required', sub: 'A core service is down. See action items below for the fastest fix.' },
  }

  const siteStatusMap = useMemo(() => Object.fromEntries(siteUptime.map((s) => [s.id, s.status])), [siteUptime])
  const archNodes = useMemo(() => buildArchNodes(report?.checks ?? [], siteStatusMap), [report, siteStatusMap])

  const platformFaults = useMemo((): PlatformFault[] => {
    const faults: PlatformFault[] = []
    report?.checks.forEach((c) => {
      if (c.status === 'fail') faults.push({ id: c.id, severity: 'critical', title: c.label, detail: c.message, source: 'health-check' })
      else if (c.status === 'warn') faults.push({ id: c.id, severity: 'warning', title: c.label, detail: c.message, source: 'health-check' })
    })
    if (pulse.expired > 0) {
      faults.push({
        id: 'expired-accounts',
        severity: 'warning',
        title: `${pulse.expired} expired / suspended`,
        detail: 'Review Accounts for customers off-network.',
        source: 'subscriptions',
      })
    }
    return faults
  }, [report, pulse.expired])

  const actionItems = useMemo(() => {
    const items: string[] = []
    if (pulse.due3 > 0) items.push(`${pulse.due3} subscription(s) expire in 3 days or less.`)
    if (pulse.grace > 0) items.push(`${pulse.grace} customer(s) on grace / partial fee — collect remaining balance.`)
    if (pulse.openIssues > 0) items.push(`${pulse.openIssues} open issue ticket(s).`)
    report?.checks.forEach((c) => {
      if (c.status === 'fail') items.push(`${c.label}: ${c.message}`)
    })
    return items
  }, [pulse, report])

  const tabs: Array<[TcdTab, string]> = [
    ['overview', 'Overview'],
    ['accounts', 'Accounts'],
    ['plans', 'Plans'],
    ['issues', 'Issues'],
    ['chat', 'Chat'],
    ['storage', 'Storage'],
    ['system', 'System'],
    ['architecture', 'Architecture'],
  ]

  const canManage = isAdmin || isStaff

  return (
    <div className="tcd-shell">
      <header className="tcd-hero">
        <div className="tcd-hero-top">
          <div className="tcd-brand">
            <img src="./logo-gn.png" alt="" className="tcd-logo-mark" />
            GlobalNetwork Ops
          </div>
          <div className="tcd-identity">
            <p>
              Signed in as <strong>{email}</strong>
              {isAdmin && <span className="tcd-admin-badge">ADMIN</span>}
            </p>
            <p>Org: {orgId || 'globalnetwork'}</p>
          </div>
        </div>

        {canManage && (
          <nav className="tcd-tabs" aria-label="Control plane sections">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" className={`tcd-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
        )}

        <div className="tcd-status-composition">
          <div className={`tcd-globe status-${overallStatus}`}>
            <span className="tcd-globe-orbit" />
            <img src="./logo-gn.png" alt="" />
          </div>
          <div>
            <h1 className="tcd-status-title">{statusCopy[overallStatus].title}</h1>
            <p className="tcd-status-sub">{statusCopy[overallStatus].sub}</p>
            <div className="tcd-hero-actions">
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void run()}>
                {busy ? 'Running…' : 'Run health check'}
              </button>
              <button className="btn btn-ghost-on-dark" type="button" disabled={busy} onClick={() => void runRepair()}>
                Run auto-repair
              </button>
              <a className="btn btn-ghost-on-dark" href={OPS_WEB_URL} target="_blank" rel="noreferrer">
                Open staff dashboard
              </a>
              <button className="btn btn-ghost-on-dark" type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
            <p className="tcd-refresh-note" style={{ marginTop: '1rem' }}>
              <span className="tcd-refresh-dot" aria-hidden="true" />
              Auto-refresh every 60s · last run {timeAgo(lastRunMs)}
            </p>
          </div>
        </div>
      </header>

      <main className="tcd-main">
        {error && <div className="tcd-banner error">{error}</div>}
        {statusMsg && <div className="tcd-banner ok">{statusMsg}</div>}

        {tab === 'overview' && (
          <>
            {platformFaults.length > 0 && (
              <section className="tcd-faults">
                <h2>Alerts &amp; faults</h2>
                <ul>
                  {platformFaults.map((f) => (
                    <li key={f.id} className={`tcd-fault severity-${f.severity}`}>
                      <span className={`pill tcd-${f.severity === 'critical' ? 'fail' : f.severity === 'warning' ? 'warn' : 'ok'}`}>
                        {f.severity.toUpperCase()}
                      </span>
                      <span>
                        <strong>{f.title}</strong> — {f.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {actionItems.length > 0 && (
              <section className="tcd-action-items">
                <h2>Action items</h2>
                <ul>
                  {actionItems.map((item, i) => (
                    <li key={`${item}-${i}`}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
            <section className="tcd-ops-pulse" aria-label="Operations pulse">
              <div className="tcd-pulse-grid">
                <article className="tcd-pulse-card">
                  <p className="tcd-pulse-eyebrow">Subscribers</p>
                  <p className="tcd-pulse-value">{pulse.total}</p>
                  <p className="tcd-pulse-meta">
                    {pulse.active} active · {pulse.grace} grace · {pulse.expired} expired
                  </p>
                  <div className="tcd-kpi-spark" />
                </article>
                <article className="tcd-pulse-card">
                  <p className="tcd-pulse-eyebrow">Due in 3 days</p>
                  <p className={`tcd-pulse-value ${pulse.due3 > 0 ? 'fail' : ''}`}>{pulse.due3}</p>
                  <p className="tcd-pulse-meta">Need a collection or extend-days call</p>
                </article>
                <article className="tcd-pulse-card">
                  <p className="tcd-pulse-eyebrow">Open chats / issues</p>
                  <p className="tcd-pulse-value">
                    {pulse.openChat}
                    <span className="tcd-pulse-of"> / {pulse.openIssues}</span>
                  </p>
                  <p className="tcd-pulse-meta">Unread threads · open tickets</p>
                </article>
                <article className="tcd-pulse-card">
                  <p className="tcd-pulse-eyebrow">Unpaid balance</p>
                  <p className="tcd-pulse-value" style={{ fontSize: '1.6rem' }}>
                    {repo.formatGyd(pulse.balance)}
                  </p>
                  <p className="tcd-pulse-meta">Partial fees still owed</p>
                </article>
              </div>
            </section>
            <div className="tcd-grid">
              <CheckCard title="Platform" checks={report?.checks.filter((c) => c.group === 'platform') ?? []} />
              <CheckCard title="Fleet" checks={report?.checks.filter((c) => c.group === 'fleet') ?? []} />
              <div className="tcd-card">
                <div className="tcd-card-head">
                  <h2>Published sites</h2>
                </div>
                <ul className="tcd-check-list">
                  {siteUptime.map((s) => (
                    <li key={s.id} className="tcd-check-row">
                      <span className={`pill tcd-${s.status}`}>{s.status.toUpperCase()}</span>
                      <span>
                        <strong>{s.label}</strong> — {s.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {repairLog.length > 0 && (
                <div className="tcd-card">
                  <div className="tcd-card-head">
                    <h2>Last auto-repair actions</h2>
                  </div>
                  <ul className="tcd-repair-log">
                    {repairLog.map((line, idx) => (
                      <li key={`${line}-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'accounts' && canManage && (
          <AccountsPanel
            customers={customers}
            plans={plans}
            nowTick={nowTick}
            busy={busy}
            onBusy={setBusy}
            onStatus={setStatusMsg}
            onError={setError}
          />
        )}
        {tab === 'plans' && canManage && (
          <PlansPanel plans={plans} busy={busy} onBusy={setBusy} onStatus={setStatusMsg} onError={setError} />
        )}
        {tab === 'issues' && canManage && <IssuesPanel issues={issues} />}
        {tab === 'chat' && canManage && <ChatPanel customers={customers} />}
        {tab === 'storage' && canManage && <StoragePanel busy={busy} onBusy={setBusy} onError={setError} />}
        {tab === 'system' && canManage && (
          <SystemPanel busy={busy} onBusy={setBusy} onStatus={setStatusMsg} onError={setError} />
        )}
        {tab === 'architecture' && canManage && (
          <div className="tcd-card tcd-card-wide tcd-arch-card">
            <div className="tcd-card-head">
              <h2>System architecture</h2>
              <span className="tcd-card-timestamp">live probe status</span>
            </div>
            <ArchitectureTree nodes={archNodes} selectedId={archSelected} onSelect={setArchSelected} loading={!report} />
          </div>
        )}
      </main>

      <p className="tcd-footer-note">
        GlobalNetwork Total Control Dashboard · <a href={TCD_URL}>GitHub Pages TCD</a> ·{' '}
        <a href={OPS_WEB_URL}>Firebase Hosting ops-web</a> · <a href={MARKETING_URL}>Back to marketing site</a>
        {isAdmin && <> · Hard-refresh (Ctrl+Shift+R) after deploys to bust cached JS/CSS.</>}
      </p>
    </div>
  )
}

function CheckCard({ title, checks }: { title: string; checks: TcdCheck[] }) {
  return (
    <div className="tcd-card">
      <div className="tcd-card-head">
        <h2>{title}</h2>
      </div>
      {checks.length === 0 ? (
        <p className="tcd-empty-note">No checks run yet — click Run health check above.</p>
      ) : (
        <ul className="tcd-check-list">
          {checks.map((c) => (
            <li key={c.id} className="tcd-check-row">
              <span className={`pill tcd-${c.status}`}>{c.status.toUpperCase()}</span>
              <span>
                <strong>{c.label}</strong> — {c.message}
                {c.latencyMs != null && <span className="muted small"> ({c.latencyMs} ms)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
