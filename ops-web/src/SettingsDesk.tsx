import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DEFAULT_ORG_SETTINGS, DEFAULT_QBO_STATUS, QBO_REDIRECT_URI, type Customer, type OrgSettings, type QboEnvironment, type QboPublicStatus } from './lib/types'
import * as repo from './lib/repo'
import { AccountsDesk } from './AccountsDesk'

const RESET_PHRASE = 'RESET GLOBALNETWORK'
type SettingsTab = 'roles' | 'desk' | 'tidy'

export function SettingsDesk({ org, customers = [] }: { org: OrgSettings | null; customers?: Customer[] }) {
  const [params, setParams] = useSearchParams()
  const tab: SettingsTab =
    params.get('tab') === 'roles' || params.get('tab') === 'tidy' ? (params.get('tab') as SettingsTab) : 'desk'
  const setTab = (next: SettingsTab) => {
    const copy = new URLSearchParams(params)
    if (next === 'desk') copy.delete('tab')
    else copy.set('tab', next)
    setParams(copy, { replace: true })
  }
  const [name, setName] = useState(DEFAULT_ORG_SETTINGS.name)
  const [supportPhone, setSupportPhone] = useState('')
  const [supportWhatsapp, setSupportWhatsapp] = useState('')
  const [botEnabled, setBotEnabled] = useState(true)
  const [callRecordingDefault, setCallRecordingDefault] = useState(false)
  const [renewalWarnDays, setRenewalWarnDays] = useState(String(DEFAULT_ORG_SETTINGS.renewalWarnDays))
  const [timezone, setTimezone] = useState(DEFAULT_ORG_SETTINGS.timezone)
  const [resetPhrase, setResetPhrase] = useState('')
  const [phrases, setPhrases] = useState<Record<string, string>>({})
  const [oldDays, setOldDays] = useState('30')
  const [staleDays, setStaleDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [resetCounts, setResetCounts] = useState<repo.FactoryResetResult | null>(null)
  const [tidyResult, setTidyResult] = useState<repo.TidyResult | null>(null)
  const [qbo, setQbo] = useState<QboPublicStatus>(DEFAULT_QBO_STATUS)
  const [qboClientId, setQboClientId] = useState('')
  const [qboClientSecret, setQboClientSecret] = useState('')
  const [qboEnvironment, setQboEnvironment] = useState<QboEnvironment>('sandbox')
  const [qboLoading, setQboLoading] = useState(true)

  useEffect(() => {
    const next = org ?? DEFAULT_ORG_SETTINGS
    setName(next.name)
    setSupportPhone(next.supportPhone)
    setSupportWhatsapp(next.supportWhatsapp)
    setBotEnabled(next.botEnabled)
    setCallRecordingDefault(next.callRecordingDefault)
    setRenewalWarnDays(String(next.renewalWarnDays))
    setTimezone(next.timezone)
  }, [org])

  useEffect(() => {
    let cancelled = false
    setQboLoading(true)
    void repo
      .qboStatus()
      .then((res) => {
        if (cancelled) return
        setQbo(res.status)
        setQboClientId(res.status.clientId)
        setQboEnvironment(res.status.environment)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load QuickBooks status')
      })
      .finally(() => {
        if (!cancelled) setQboLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stale = useMemo(
    () => customers.filter((c) => repo.isStaleCustomer(c, Date.now(), Number(staleDays) || 30)),
    [customers, staleDays],
  )
  const duplicateGroups = useMemo(() => {
    const map = new Map<string, Customer[]>()
    for (const c of customers) {
      const email = c.email.trim().toLowerCase()
      if (!email) continue
      const list = map.get(email) ?? []
      list.push(c)
      map.set(email, list)
    }
    return [...map.values()].filter((group) => group.length > 1)
  }, [customers])
  const duplicateExtras = duplicateGroups.reduce((n, group) => n + group.length - 1, 0)

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      setMsg(await work())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await repo.saveOrgSettings({
        name: name.trim() || DEFAULT_ORG_SETTINGS.name,
        supportPhone: supportPhone.trim(),
        supportWhatsapp: supportWhatsapp.trim(),
        botEnabled,
        callRecordingDefault,
        renewalWarnDays: Number(renewalWarnDays),
        timezone: timezone.trim() || DEFAULT_ORG_SETTINGS.timezone,
      })
      return 'Settings saved.'
    })
  }

  const saveQbo = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const saved = await repo.saveQboConfig({
        clientId: qboClientId.trim(),
        clientSecret: qboClientSecret.trim() || undefined,
        environment: qboEnvironment,
        redirectUri: QBO_REDIRECT_URI,
      })
      setQbo(saved.status)
      setQboClientId(saved.status.clientId)
      setQboClientSecret('')
      setQboEnvironment(saved.status.environment)
      return 'QuickBooks app credentials saved. Click Connect QuickBooks to authorize the company file.'
    })
  }

  const connectQbo = () =>
    void run(async () => {
      const started = await repo.qboStartConnect()
      window.location.assign(started.authorizeUrl)
      return 'Opening Intuit…'
    })

  const disconnectQbo = () => {
    if (!window.confirm('Disconnect QuickBooks Online from this desk? Tokens will be revoked.')) return
    void run(async () => {
      const res = await repo.qboDisconnect()
      setQbo(res.status)
      return 'QuickBooks disconnected.'
    })
  }

  const tidy = (action: repo.TidyAction, confirm?: string, extra?: { olderThanDays?: number }) =>
    run(async () => {
      const result = await repo.tidyDesk({
        action,
        confirm,
        olderThanDays: extra?.olderThanDays,
      })
      setTidyResult(result)
      setPhrases((prev) => ({ ...prev, [action]: '' }))
      return result.detail || `Deleted ${result.deleted}.`
    })

  const phraseOk = resetPhrase.trim().toUpperCase() === RESET_PHRASE
  const phrase = (key: string) => (phrases[key] ?? '').trim().toUpperCase()
  const canConnect = Boolean(qbo.clientId && qbo.clientSecretSaved)

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Owner</p>
          <h1>Settings</h1>
          <p className="muted">Roles, business details, and tidy-up for the Antigua desk. Amounts stay in EC$ / XCD.</p>
        </div>
      </header>

      <div className="chips settings-tabs" role="tablist" aria-label="Settings">
        <button type="button" className={`chip ${tab === 'roles' ? 'is-on' : ''}`} onClick={() => setTab('roles')}>
          Roles
        </button>
        <button type="button" className={`chip ${tab === 'desk' ? 'is-on' : ''}`} onClick={() => setTab('desk')}>
          Desk
        </button>
        <button type="button" className={`chip ${tab === 'tidy' ? 'is-on' : ''}`} onClick={() => setTab('tidy')}>
          Tidy up
          {duplicateExtras > 0 && <span className="nav-count hot">{duplicateExtras}</span>}
        </button>
      </div>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

      {tab === 'roles' && <AccountsDesk embedded />}

      {tab === 'desk' && (
      <>
      <form className="card" onSubmit={save}>
        <div className="card-head">
          <h2>Desk</h2>
        </div>
        <div className="form-row">
          <label>
            Business name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="GlobalNetwork" />
          </label>
          <label>
            Support phone
            <input value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="+1 268…" />
          </label>
          <label>
            WhatsApp
            <input value={supportWhatsapp} onChange={(e) => setSupportWhatsapp(e.target.value)} placeholder="+1 268…" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Renewal warn days
            <input
              type="number"
              min={1}
              max={30}
              value={renewalWarnDays}
              onChange={(e) => setRenewalWarnDays(e.target.value)}
            />
          </label>
          <label>
            Timezone
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Antigua" />
          </label>
        </div>
        <label className="toggle-field">
          <input type="checkbox" checked={botEnabled} onChange={(e) => setBotEnabled(e.target.checked)} />
          Desk bot auto-replies
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={callRecordingDefault} onChange={(e) => setCallRecordingDefault(e.target.checked)} />
          Default call recording on
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
          Save settings
        </button>
      </form>

      <section className="card">
        <div className="card-head">
          <h2>QuickBooks Online</h2>
          <span className={`pill ${qbo.connected ? 'ok' : canConnect ? 'warn' : ''}`}>
            {qboLoading ? '…' : qbo.connected ? 'Connected' : canConnect ? 'Ready to connect' : 'Not configured'}
          </span>
        </div>
        <p className="muted">
          Live OAuth connects this desk to your QuickBooks company file. Invoice/payment export can follow once the
          company is linked. Keys stay in Firestore <code>adminConfig/quickbooksOnline</code> (Functions only — never
          client-readable).
        </p>
        {qbo.connected && (
          <ul className="ledger" style={{ marginBottom: '1rem' }}>
            <li>
              <span>Company</span>
              <strong>{qbo.companyName || 'QuickBooks company'}</strong>
            </li>
            <li>
              <span>Realm ID</span>
              <strong>{qbo.realmId}</strong>
            </li>
            <li>
              <span>Environment</span>
              <strong>{qbo.environment}</strong>
            </li>
          </ul>
        )}
        <form onSubmit={saveQbo}>
          <div className="form-row">
            <label>
              QBO Client ID
              <input
                value={qboClientId}
                onChange={(e) => setQboClientId(e.target.value)}
                placeholder="From Intuit Developer → Keys & OAuth"
                autoComplete="off"
              />
            </label>
            <label>
              QBO Client Secret
              <input
                type="password"
                value={qboClientSecret}
                onChange={(e) => setQboClientSecret(e.target.value)}
                placeholder={qbo.clientSecretSaved ? `Saved ·····${qbo.clientSecretLast4} — leave blank to keep` : 'Paste once, then Save'}
                autoComplete="new-password"
              />
            </label>
            <label>
              Environment
              <select value={qboEnvironment} onChange={(e) => setQboEnvironment(e.target.value as QboEnvironment)}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </label>
          </div>
          <p className="muted tiny" style={{ marginTop: '0.5rem' }}>
            Redirect URI to register in the Intuit app:{' '}
            <code>{qbo.redirectUri || QBO_REDIRECT_URI}</code>
          </p>
          <div className="quick-renew" style={{ marginTop: '0.85rem' }}>
            <button className="btn btn-ghost" type="submit" disabled={busy || !qboClientId.trim()}>
              Save QBO credentials
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || qboLoading || !canConnect || qbo.connected}
              onClick={connectQbo}
            >
              Connect QuickBooks
            </button>
            {qbo.connected && (
              <button className="btn btn-ghost danger" type="button" disabled={busy} onClick={disconnectQbo}>
                Disconnect
              </button>
            )}
          </div>
        </form>
      </section>
      </>
      )}

      {tab === 'tidy' && (
      <>
      <section className="card">
        <div className="card-head">
          <h2>Tidy up</h2>
        </div>
        <p className="muted">
          Clean old chat, tickets, calls, and leftover applications without wiping the whole desk. Each action runs as
          an owner Cloud Function so Firestore rules cannot block it.
        </p>
        {tidyResult && (
          <ul className="ledger" style={{ marginBottom: '1rem' }}>
            <li>
              <span>Last action</span>
              <strong>{tidyResult.action}</strong>
            </li>
            <li>
              <span>Deleted</span>
              <strong>{tidyResult.deleted}</strong>
            </li>
            <li>
              <span>Customers scanned</span>
              <strong>{tidyResult.scanned}</strong>
            </li>
            {typeof tidyResult.customersDeleted === 'number' && tidyResult.customersDeleted > 0 && (
              <li>
                <span>Accounts removed</span>
                <strong>{tidyResult.customersDeleted}</strong>
              </li>
            )}
            {typeof tidyResult.merged === 'number' && tidyResult.merged > 0 && (
              <li>
                <span>Email groups merged</span>
                <strong>{tidyResult.merged}</strong>
              </li>
            )}
          </ul>
        )}

        <div className="tidy-row">
          <div>
            <h3>Merge customers with the same email</h3>
            <p className="muted tiny">
              Keeps the record that has a plan, paid days, or Google uid. Moves the uid onto that row and deletes the
              empty extras. {duplicateGroups.length
                ? `${duplicateGroups.length} email${duplicateGroups.length === 1 ? '' : 's'} · ${duplicateExtras} extra row${duplicateExtras === 1 ? '' : 's'}.`
                : 'No duplicate emails on the roster right now.'}
            </p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || duplicateExtras === 0}
            onClick={() => {
              if (
                !window.confirm(
                  `Merge ${duplicateGroups.length} duplicate email group${duplicateGroups.length === 1 ? '' : 's'} and delete ${duplicateExtras} extra record${duplicateExtras === 1 ? '' : 's'}?`,
                )
              ) {
                return
              }
              void tidy('mergeDuplicateEmails')
            }}
          >
            Merge same-email customers
          </button>
        </div>
        {duplicateGroups.length > 0 && (
          <ul className="ledger" style={{ marginBottom: '0.75rem' }}>
            {duplicateGroups.slice(0, 12).map((group) => (
              <li key={group[0].email}>
                <span>
                  {group[0].name || group[0].email}
                  <span className="muted">
                    {' '}
                    · {group[0].email} · {group.length} records
                  </span>
                </span>
                <span className="muted tiny">{group.map((c) => c.name).join(', ')}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="tidy-row">
          <div>
            <h3>Clear all chat threads</h3>
            <p className="muted tiny">Deletes every customer inbox message. Type CLEAR ALL CHATS.</p>
          </div>
          <div className="tidy-actions">
            <input
              value={phrases.clearAllChats ?? ''}
              onChange={(e) => setPhrases((p) => ({ ...p, clearAllChats: e.target.value }))}
              placeholder="CLEAR ALL CHATS"
            />
            <button
              className="btn danger"
              type="button"
              disabled={busy || phrase('clearAllChats') !== 'CLEAR ALL CHATS'}
              onClick={() => {
                if (!window.confirm('Delete every chat thread on the desk?')) return
                void tidy('clearAllChats', phrases.clearAllChats)
              }}
            >
              Clear all chats
            </button>
          </div>
        </div>

        <div className="tidy-row">
          <div>
            <h3>Delete old chat messages</h3>
            <p className="muted tiny">Keeps recent messages. Older than the selected window is removed everywhere.</p>
          </div>
          <div className="tidy-actions">
            <select value={oldDays} onChange={(e) => setOldDays(e.target.value)}>
              <option value="30">Older than 30 days</option>
              <option value="90">Older than 90 days</option>
              <option value="180">Older than 180 days</option>
            </select>
            <button
              className="btn btn-ghost danger"
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete chat messages older than ${oldDays} days for every customer?`)) return
                void tidy('deleteOldChat', undefined, { olderThanDays: Number(oldDays) })
              }}
            >
              Delete old messages
            </button>
          </div>
        </div>

        <div className="tidy-row">
          <div>
            <h3>Delete voice / video clutter</h3>
            <p className="muted tiny">Removes voice notes, video clips, and call messages from chat threads.</p>
          </div>
          <button
            className="btn btn-ghost danger"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Delete all voice, video, and call chat messages?')) return
              void tidy('deleteMediaMessages')
            }}
          >
            Delete media messages
          </button>
        </div>

        <div className="tidy-row">
          <div>
            <h3>Delete resolved issues</h3>
            <p className="muted tiny">Open and ongoing tickets stay. Resolved tickets are removed.</p>
          </div>
          <button
            className="btn btn-ghost danger"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Delete every resolved ticket?')) return
              void tidy('deleteResolvedIssues')
            }}
          >
            Delete resolved
          </button>
        </div>

        <div className="tidy-row">
          <div>
            <h3>Delete all issues</h3>
            <p className="muted tiny">Removes every ticket. Type DELETE ALL ISSUES.</p>
          </div>
          <div className="tidy-actions">
            <input
              value={phrases.deleteAllIssues ?? ''}
              onChange={(e) => setPhrases((p) => ({ ...p, deleteAllIssues: e.target.value }))}
              placeholder="DELETE ALL ISSUES"
            />
            <button
              className="btn danger"
              type="button"
              disabled={busy || phrase('deleteAllIssues') !== 'DELETE ALL ISSUES'}
              onClick={() => {
                if (!window.confirm('Delete every line ticket, including open ones?')) return
                void tidy('deleteAllIssues', phrases.deleteAllIssues)
              }}
            >
              Delete all issues
            </button>
          </div>
        </div>

        <div className="tidy-row">
          <div>
            <h3>Delete ended / missed calls</h3>
            <p className="muted tiny">Drops finished call records and recording metadata. Live or ringing calls stay.</p>
          </div>
          <button
            className="btn btn-ghost danger"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Delete ended and missed call records?')) return
              void tidy('purgeCalls')
            }}
          >
            Purge call records
          </button>
        </div>

        <div className="tidy-row">
          <div>
            <h3>Purge admin audit logs</h3>
            <p className="muted tiny">Wipes the owner activity log. Type PURGE AUDIT LOGS.</p>
          </div>
          <div className="tidy-actions">
            <input
              value={phrases.purgeAuditLogs ?? ''}
              onChange={(e) => setPhrases((p) => ({ ...p, purgeAuditLogs: e.target.value }))}
              placeholder="PURGE AUDIT LOGS"
            />
            <button
              className="btn danger"
              type="button"
              disabled={busy || phrase('purgeAuditLogs') !== 'PURGE AUDIT LOGS'}
              onClick={() => {
                if (!window.confirm('Delete all admin audit logs?')) return
                void tidy('purgeAuditLogs', phrases.purgeAuditLogs)
              }}
            >
              Purge audit logs
            </button>
          </div>
        </div>

        <div className="tidy-row">
          <div>
            <h3>Delete stale / rejected customers</h3>
            <p className="muted tiny">
              Rejected KYC, plus unsigned expired records older than the selected window. Live and paid accounts stay.
              Type DELETE STALE CUSTOMERS.
            </p>
          </div>
          <div className="tidy-actions">
            <select value={staleDays} onChange={(e) => setStaleDays(e.target.value)}>
              <option value="30">Unused 30+ days</option>
              <option value="90">Unused 90+ days</option>
            </select>
            <input
              value={phrases.deleteRejectedCustomers ?? ''}
              onChange={(e) => setPhrases((p) => ({ ...p, deleteRejectedCustomers: e.target.value }))}
              placeholder="DELETE STALE CUSTOMERS"
            />
            <button
              className="btn danger"
              type="button"
              disabled={busy || phrase('deleteRejectedCustomers') !== 'DELETE STALE CUSTOMERS'}
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete ${stale.length} rejected/stale customer${stale.length === 1 ? '' : 's'}? This cannot be undone.`,
                  )
                ) {
                  return
                }
                void tidy('deleteRejectedCustomers', phrases.deleteRejectedCustomers, {
                  olderThanDays: Number(staleDays),
                })
              }}
            >
              Delete stale customers
            </button>
          </div>
        </div>

        {stale.length > 0 && (
          <ul className="ledger" style={{ marginTop: '0.75rem' }}>
            {stale.slice(0, 20).map((c) => (
              <li key={c.id}>
                <span>
                  <Link to={`/c/${c.id}`}>{c.name || c.email || c.id}</Link>
                  <span className="muted">
                    {' '}
                    · {c.approvalStatus === 'rejected' ? 'rejected KYC' : `${c.status}, never signed in`}
                  </span>
                </span>
                <Link to={`/c/${c.id}`} className="text-btn">
                  Open
                </Link>
              </li>
            ))}
            {stale.length > 20 && (
              <li>
                <span className="muted">+{stale.length - 20} more match this filter</span>
              </li>
            )}
          </ul>
        )}
        {stale.length === 0 && (
          <p className="muted tiny" style={{ marginTop: '0.75rem' }}>
            No rejected or unused expired records match the current window.
          </p>
        )}
      </section>

      <section className="card danger-zone">
        <div className="card-head">
          <h2>Factory reset</h2>
        </div>
        <p className="muted">
          Deletes every customer (chat, tickets, payments, calls), wipes plans, invites, and audit logs, then reseeds
          the default 15 / 30 / 90-day plans. Owner accounts and desk members stay.
        </p>
        <label>
          Type RESET GLOBALNETWORK
          <input value={resetPhrase} onChange={(e) => setResetPhrase(e.target.value)} placeholder="RESET GLOBALNETWORK" />
        </label>
        <button
          className="btn danger"
          type="button"
          disabled={busy || !phraseOk}
          style={{ marginTop: '0.85rem' }}
          onClick={() => {
            if (!window.confirm('This permanently wipes customers and plans. Owner login stays. Continue?')) return
            void run(async () => {
              const result = await repo.factoryReset(resetPhrase)
              setResetCounts(result)
              setResetPhrase('')
              return `Factory reset complete. ${result.customersDeleted} customers and ${result.plansDeleted} plans removed.`
            })
          }}
        >
          Factory reset
        </button>
        {resetCounts && (
          <ul className="ledger" style={{ marginTop: '1rem' }}>
            <li>
              <span>Customers deleted</span>
              <strong>{resetCounts.customersDeleted}</strong>
            </li>
            <li>
              <span>Plans deleted</span>
              <strong>{resetCounts.plansDeleted}</strong>
            </li>
            <li>
              <span>Audit logs deleted</span>
              <strong>{resetCounts.auditLogsDeleted}</strong>
            </li>
            <li>
              <span>Desk invites deleted</span>
              <strong>{resetCounts.invitesDeleted}</strong>
            </li>
            <li>
              <span>Admin config deleted</span>
              <strong>{resetCounts.adminConfigDeleted}</strong>
            </li>
          </ul>
        )}
      </section>
      </>
      )}
    </div>
  )
}
