import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Customer, OmadaNetworkStatus, OmadaClientInfo, OmadaActionLog, OmadaOpenApiConfig } from './lib/types'
import * as repo from './lib/repo'

type Phase = 'disconnected' | 'connecting' | 'connected' | 'error'

function phaseOf(status: OmadaNetworkStatus | null, connecting: boolean): Phase {
  if (connecting) return 'connecting'
  if (!status) return 'disconnected'
  if (status.connected) return 'connected'
  if (status.error) return 'error'
  return 'disconnected'
}

function phaseLabel(phase: Phase): string {
  if (phase === 'connected') return 'Connected'
  if (phase === 'connecting') return 'Connecting'
  if (phase === 'error') return 'Error'
  return 'Disconnected'
}

function flag(ok: boolean | null | undefined, label: string) {
  const tone = ok === true ? 'ok' : ok === false ? 'fail' : 'warn'
  const text = ok === true ? 'Yes' : ok === false ? 'No' : '—'
  return (
    <li>
      <span>{label}</span>
      <span className={`pill ${tone}`}>{text}</span>
    </li>
  )
}

function fmtTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleString('en-GB', { timeZone: 'America/Antigua', hour12: false })
}

const EMPTY_CONFIG: OmadaOpenApiConfig = {
  controllerUrl: '',
  clientIdSaved: false,
  clientIdLast4: '',
  clientSecretSaved: false,
  siteName: 'Default',
  cfAccessConfigured: false,
  allowInsecureTls: false,
  autoBlockOnExpire: false,
  autoUnblockOnPayment: true,
  dryRun: true,
}

export function NetworkDesk({ customers }: { customers: Customer[] }) {
  const [status, setStatus] = useState<OmadaNetworkStatus | null>(null)
  const [clients, setClients] = useState<OmadaClientInfo[]>([])
  const [logs, setLogs] = useState<OmadaActionLog[]>([])
  const [connecting, setConnecting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Config form state
  const [controllerUrl, setControllerUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [siteName, setSiteName] = useState('Default')
  const [cfAccessClientId, setCfAccessClientId] = useState('')
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState('')
  const [allowInsecureTls, setAllowInsecureTls] = useState(false)
  const [autoBlockOnExpire, setAutoBlockOnExpire] = useState(false)
  const [autoUnblockOnPayment, setAutoUnblockOnPayment] = useState(true)
  const [dryRun, setDryRun] = useState(true)

  // Test customer flow
  const [testCustomerId, setTestCustomerId] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)

  const applyConfig = (config: OmadaOpenApiConfig) => {
    setControllerUrl(config.controllerUrl)
    setSiteName(config.siteName || 'Default')
    setAllowInsecureTls(config.allowInsecureTls)
    setAutoBlockOnExpire(config.autoBlockOnExpire)
    setAutoUnblockOnPayment(config.autoUnblockOnPayment)
    setDryRun(config.dryRun)
  }

  const refreshStatus = useCallback(async () => {
    setConnecting(true)
    setErr(null)
    try {
      const next = await repo.omadaOpenApiStatus()
      setStatus(next)
      applyConfig(next.config ?? EMPTY_CONFIG)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Status check failed')
    } finally {
      setConnecting(false)
    }
  }, [])

  const refreshClients = useCallback(async () => {
    try {
      const listed = await repo.omadaOpenApiListClients()
      setClients(listed.clients ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not list clients')
    }
  }, [])

  const refreshLogs = useCallback(async () => {
    try {
      const result = await repo.omadaOpenApiGetActionLog({ limit: 50 })
      setLogs(result.logs ?? [])
    } catch {
      // Ignore log fetch errors
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    void refreshLogs()
  }, [refreshStatus, refreshLogs])

  useEffect(() => {
    if (status?.connected) {
      void refreshClients()
    }
  }, [status?.connected, refreshClients])

  const phase = phaseOf(status, connecting)

  const saveConfig = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const result = await repo.saveOmadaOpenApiConfig({
        controllerUrl,
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
        siteName,
        cfAccessClientId: cfAccessClientId || undefined,
        cfAccessClientSecret: cfAccessClientSecret || undefined,
        allowInsecureTls,
        autoBlockOnExpire,
        autoUnblockOnPayment,
        dryRun,
      })
      applyConfig(result.config)
      setClientId('')
      setClientSecret('')
      setCfAccessClientId('')
      setCfAccessClientSecret('')
      setMsg('Configuration saved. Testing connection…')
      await refreshStatus()
      if (status?.connected) {
        await refreshClients()
      }
      setMsg('Configuration saved and connection tested.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const testCustomer = async () => {
    if (!testCustomerId.trim()) {
      setTestResult('Select a customer to test')
      return
    }
    setBusy(true)
    setTestResult(null)
    try {
      const result = await repo.omadaOpenApiTestCustomer(testCustomerId)
      setTestResult(
        `Test complete for ${result.customerName} (${result.mac}):\n` +
        `  Block test: ${result.blockTest.success ? '✓' : '✗'} ${result.blockTest.method}\n` +
        `  Unblock test: ${result.unblockTest.success ? '✓' : '✗'} ${result.unblockTest.method}\n` +
        `  Config dry-run: ${result.configDryRun ? 'Yes (no actual changes)' : 'No (live mode)'}`
      )
      await refreshLogs()
    } catch (e) {
      setTestResult(`Test failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  const blockClient = async (customerId: string, mac: string, block: boolean) => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const result = await repo.omadaOpenApiSetClientBlocked({
        customerId,
        mac,
        blocked: block,
        trigger: 'manual',
      })
      setMsg(`${block ? 'Blocked' : 'Unblocked'} ${result.mac}${result.dryRun ? ' (dry-run)' : ''}`)
      await refreshClients()
      await refreshLogs()
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${block ? 'Block' : 'Unblock'} failed`)
    } finally {
      setBusy(false)
    }
  }

  const customersWithCpe = customers.filter(c => c.omadaClientMac || c.cpeMac)

  return (
    <div className="desk omada-desk">
      <header className="desk-head">
        <h1>Network · Omada Open API</h1>
        <div className={`omada-status is-${phase}`}>
          <span className="omada-state-label">{phaseLabel(phase)}</span>
          {status?.dryRun && <span className="pill warn">Dry-run</span>}
        </div>
      </header>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

      <section className="card">
        <div className="card-head">
          <h2>Controller connection</h2>
          <button className="btn ghost small" type="button" disabled={busy} onClick={() => void refreshStatus()}>
            Refresh
          </button>
        </div>

        {status && (
          <ul className="omada-flags">
            {flag(status.configured, 'Configured')}
            {flag(status.controllerOk, 'Controller reachable')}
            {flag(status.authOk, 'OAuth OK')}
            {flag(status.siteFound, 'Site found')}
            {flag(status.connected, 'Connected')}
          </ul>
        )}

        {status?.error && <p className="fail">{status.error}</p>}

        {status?.connected && (
          <p className="muted">
            Controller: {status.controllerId} · Site: {status.siteName} ({status.siteId})
          </p>
        )}

        <form onSubmit={(e) => void saveConfig(e)} style={{ marginTop: '1rem' }}>
          <div className="form-row">
            <label>
              Controller URL
              <input
                value={controllerUrl}
                onChange={(e) => setControllerUrl(e.target.value)}
                placeholder="https://omada.example.com"
                required
              />
            </label>
            <label>
              Site name
              <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Default" />
            </label>
          </div>
          <div className="form-row">
            <label>
              Open API Client ID
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={status?.config?.clientIdSaved ? `Saved (…${status.config.clientIdLast4})` : 'From Platform Integration'}
              />
            </label>
            <label>
              Open API Client Secret
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={status?.config?.clientSecretSaved ? 'Saved (hidden)' : 'From Platform Integration'}
              />
            </label>
          </div>
          <p className="muted tiny">
            Get OAuth credentials from Omada Controller → Settings → Platform Integration → Open API.
            {status?.config?.cfAccessConfigured && ' Cloudflare Access service token is also configured.'}
          </p>
          <div className="form-row" style={{ marginTop: '0.75rem' }}>
            <label className="inline">
              <input type="checkbox" checked={autoBlockOnExpire} onChange={(e) => setAutoBlockOnExpire(e.target.checked)} />
              Auto-block CPE on expiry
            </label>
            <label className="inline">
              <input type="checkbox" checked={autoUnblockOnPayment} onChange={(e) => setAutoUnblockOnPayment(e.target.checked)} />
              Auto-unblock CPE on payment
            </label>
            <label className="inline">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              Dry-run mode (no actual blocks)
            </label>
            <label className="inline">
              <input type="checkbox" checked={allowInsecureTls} onChange={(e) => setAllowInsecureTls(e.target.checked)} />
              Allow insecure TLS
            </label>
          </div>
          <button className="btn primary" type="submit" disabled={busy}>
            Save & test connection
          </button>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Test one customer</h2>
        </div>
        <p className="muted">
          Test block/unblock for a single customer without affecting production. Always runs in dry-run mode.
        </p>
        <div className="form-row">
          <label>
            Customer with CPE MAC
            <select value={testCustomerId} onChange={(e) => setTestCustomerId(e.target.value)}>
              <option value="">Select customer…</option>
              {customersWithCpe.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.omadaClientMac || c.cpeMac}
                </option>
              ))}
            </select>
          </label>
          <button className="btn ghost" type="button" disabled={busy || !testCustomerId} onClick={() => void testCustomer()}>
            Run test
          </button>
        </div>
        {testResult && <pre className="muted" style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{testResult}</pre>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>CPE per customer</h2>
        </div>
        <p className="muted">
          Each customer location has one CPE MAC (the wireless station on the AP). Block/unblock controls that station only — never the ER7206 gateway.
        </p>
        <table className="data-table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>Customer</th>
              <th>CPE MAC</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {customersWithCpe.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">No customers have CPE MACs mapped yet.</td>
              </tr>
            )}
            {customersWithCpe.map((c) => {
              const mac = c.omadaClientMac || c.cpeMac || ''
              const client = clients.find((cl) => cl.mac.replace(/-/g, '').toUpperCase() === mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase())
              return (
                <tr key={c.id}>
                  <td>
                    <Link to={`/customer/${c.id}`}>{c.name}</Link>
                    <span className="muted tiny"> · {c.status}</span>
                  </td>
                  <td><code>{mac}</code></td>
                  <td>
                    {client ? (
                      <>
                        <span className={`pill ${client.blocked ? 'fail' : client.active ? 'ok' : 'warn'}`}>
                          {client.blocked ? 'Blocked' : client.active ? 'Online' : 'Offline'}
                        </span>
                        {client.apName && <span className="muted tiny"> · {client.apName}</span>}
                      </>
                    ) : (
                      <span className="muted">Not seen</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn ghost small"
                      type="button"
                      disabled={busy || !mac}
                      onClick={() => mac && void blockClient(c.id, mac, true)}
                    >
                      Block
                    </button>
                    <button
                      className="btn ghost small"
                      type="button"
                      disabled={busy || !mac}
                      onClick={() => mac && void blockClient(c.id, mac, false)}
                    >
                      Unblock
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Action log</h2>
          <button className="btn ghost small" type="button" disabled={busy} onClick={() => void refreshLogs()}>
            Refresh
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>MAC</th>
              <th>Customer</th>
              <th>Trigger</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No actions logged yet.</td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{fmtTime(log.atMs)}</td>
                <td>
                  <span className={`pill ${log.action === 'block' ? 'fail' : log.action === 'unblock' ? 'ok' : 'warn'}`}>
                    {log.action}
                  </span>
                  {log.dryRun && <span className="pill warn" style={{ marginLeft: 4 }}>dry</span>}
                </td>
                <td><code>{log.mac}</code></td>
                <td>
                  {log.customerId ? (
                    <Link to={`/customer/${log.customerId}`}>{log.customerName || log.customerId}</Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{log.trigger}</td>
                <td>
                  {log.success ? (
                    <span className="pill ok">OK</span>
                  ) : (
                    <span className="pill fail" title={log.error}>Failed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>What to provide</h2>
        </div>
        <div className="muted">
          <p><strong>To configure Omada Open API integration, you need:</strong></p>
          <ol style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            <li><strong>Controller URL</strong> — the HTTPS address of your Omada software/hardware controller (e.g. <code>https://omada.example.com</code>)</li>
            <li><strong>Open API credentials</strong> — from Controller → Settings → Platform Integration → Open API. Create an application and copy the Client ID and Client Secret.</li>
            <li><strong>Site name</strong> — usually "Default", or the site where your ER7206 and APs live</li>
            <li><strong>Cloudflare Access</strong> (if applicable) — if your controller is behind Cloudflare Access, create a service token and provide the Client ID and Client Secret</li>
            <li><strong>Per-customer CPE MAC</strong> — the wireless station MAC of each house's CPE on the AP (NOT the ER7206 WAN MAC)</li>
          </ol>
          <p style={{ marginTop: '0.75rem' }}>
            <strong>How it works:</strong> When a subscription expires, the expiry sweep blocks only that customer's CPE MAC on the AP — the ER7206 gateway and other customers are unaffected. When a payment or extension is processed, the CPE is automatically unblocked.
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            <strong>Dry-run mode:</strong> Enable this to test the integration without actually blocking/unblocking anyone. All actions are logged.
          </p>
        </div>
      </section>
    </div>
  )
}
