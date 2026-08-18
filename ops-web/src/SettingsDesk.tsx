import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from './lib/types'
import * as repo from './lib/repo'

const RESET_PHRASE = 'RESET GLOBALNETWORK'

export function SettingsDesk({ org }: { org: OrgSettings | null }) {
  const [name, setName] = useState(DEFAULT_ORG_SETTINGS.name)
  const [supportPhone, setSupportPhone] = useState('')
  const [supportWhatsapp, setSupportWhatsapp] = useState('')
  const [botEnabled, setBotEnabled] = useState(true)
  const [callRecordingDefault, setCallRecordingDefault] = useState(false)
  const [renewalWarnDays, setRenewalWarnDays] = useState(String(DEFAULT_ORG_SETTINGS.renewalWarnDays))
  const [timezone, setTimezone] = useState(DEFAULT_ORG_SETTINGS.timezone)
  const [resetPhrase, setResetPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [resetCounts, setResetCounts] = useState<repo.FactoryResetResult | null>(null)

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

  const phraseOk = resetPhrase.trim().toUpperCase() === RESET_PHRASE

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Owner</p>
          <h1>Settings</h1>
          <p className="muted">Business details for the Antigua desk. Amounts stay in EC$ / XCD.</p>
        </div>
      </header>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

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
    </div>
  )
}
