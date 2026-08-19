import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { DEFAULT_OMADA_FW, DEFAULT_OMADA_HW, type Customer, type OmadaClientRow, type OmadaPublicConfig, type OmadaStatus } from './lib/types'
import * as repo from './lib/repo'

const EMPTY_CONFIG: OmadaPublicConfig = {
  controllerUrl: '',
  username: '',
  passwordSaved: false,
  passwordLast4: '',
  siteName: 'Default',
  deviceMac: '',
  cfAccessClientId: '',
  cfAccessSecretSaved: false,
  cfAccessSecretLast4: '',
  hardwareVersion: DEFAULT_OMADA_HW,
  firmwareVersion: DEFAULT_OMADA_FW,
  allowInsecureTls: false,
  autoSuspendOnExpire: false,
}

type Phase = 'disconnected' | 'connecting' | 'connected' | 'error'

function phaseOf(status: OmadaStatus | null, connecting: boolean): Phase {
  if (connecting) return 'connecting'
  if (!status) return 'disconnected'
  if (status.connected) return 'connected'
  if (status.status === 'error') return 'error'
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

function formatBytes(n: number): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function OmadaDesk({ customers }: { customers: Customer[] }) {
  const [status, setStatus] = useState<OmadaStatus | null>(null)
  const [clients, setClients] = useState<OmadaClientRow[]>([])
  const [connecting, setConnecting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [controllerUrl, setControllerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [siteName, setSiteName] = useState('Default')
  const [deviceMac, setDeviceMac] = useState('')
  const [cfAccessClientId, setCfAccessClientId] = useState('')
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState('')
  const [hardwareVersion, setHardwareVersion] = useState(DEFAULT_OMADA_HW)
  const [firmwareVersion, setFirmwareVersion] = useState(DEFAULT_OMADA_FW)
  const [allowInsecureTls, setAllowInsecureTls] = useState(false)
  const [autoSuspendOnExpire, setAutoSuspendOnExpire] = useState(false)
  const [showWired, setShowWired] = useState(false)

  const applyConfig = (config: OmadaPublicConfig) => {
    setControllerUrl(config.controllerUrl)
    setUsername(config.username)
    setSiteName(config.siteName || 'Default')
    setDeviceMac(config.deviceMac)
    setCfAccessClientId(config.cfAccessClientId)
    setHardwareVersion(config.hardwareVersion || DEFAULT_OMADA_HW)
    setFirmwareVersion(config.firmwareVersion || DEFAULT_OMADA_FW)
    setAllowInsecureTls(config.allowInsecureTls)
    setAutoSuspendOnExpire(config.autoSuspendOnExpire)
  }

  const refreshClients = useCallback(async () => {
    const listed = await repo.omadaEr7206ListClients()
    setClients(listed.clients ?? [])
  }, [])

  const refresh = useCallback(async () => {
    setConnecting(true)
    setErr(null)
    try {
      const next = await repo.omadaEr7206Status()
      setStatus(next)
      applyConfig(next.config ?? EMPTY_CONFIG)
      if (next.connected) {
        try {
          await refreshClients()
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'Could not list clients')
        }
      } else if (next.error) {
        setErr(next.error)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Status failed')
      setStatus(null)
    } finally {
      setConnecting(false)
    }
  }, [refreshClients])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      setMsg(await work())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const saved = await repo.saveOmadaConfig({
        controllerUrl: controllerUrl.trim(),
        username: username.trim(),
        password: password.trim() || undefined,
        siteName: siteName.trim() || 'Default',
        deviceMac: deviceMac.trim(),
        cfAccessClientId: cfAccessClientId.trim(),
        cfAccessClientSecret: cfAccessClientSecret.trim() || undefined,
        hardwareVersion: hardwareVersion.trim() || DEFAULT_OMADA_HW,
        firmwareVersion: firmwareVersion.trim() || DEFAULT_OMADA_FW,
        allowInsecureTls,
        autoSuspendOnExpire,
      })
      setPassword('')
      setCfAccessClientSecret('')
      applyConfig(saved.config)
      const next = await repo.omadaEr7206Status()
      setStatus(next)
      applyConfig(next.config)
      if (next.connected) await refreshClients()
      return next.connected
        ? 'Saved. Omada can see the ER7206. Map each house CPE wireless MAC, then disconnect that station.'
        : 'Saved. Hard-refresh /ops/ if this is the first deploy, then Test connection.'
    })
  }

  const test = () =>
    run(async () => {
      setConnecting(true)
      try {
        const next = await repo.omadaEr7206Status()
        setStatus(next)
        applyConfig(next.config)
        if (next.connected) {
          await refreshClients()
          return 'Connected — Omada can see the ER7206. Disconnect a house CPE on the AP, not the gateway WAN.'
        }
        throw new Error(next.error || 'Not connected.')
      } finally {
        setConnecting(false)
      }
    })

  const setBlocked = (row: OmadaClientRow, blocked: boolean) => {
    const who = row.hostname || row.ip || row.mac
    const label = blocked
      ? `Disconnect CPE at this location (${who})? This kicks/blocks the wireless station on the Omada AP. The ER7206 WAN stays up. Do not use this on a phone behind the CPE.`
      : `Reconnect CPE at this location (${who})? This unblocks the wireless station and tries Omada reconnect.`
    if (!window.confirm(label)) return
    void run(async () => {
      const result = await repo.omadaEr7206SetClientBlocked({ mac: row.mac, blocked })
      await refreshClients()
      if (blocked) return `Disconnected CPE ${result.mac} (${result.method}).`
      return `Reconnected CPE ${result.mac} (${result.method}${result.reconnectOk ? ', reconnect sent' : ''}).`
    })
  }

  const mapClient = (mac: string, customerId: string) => {
    void run(async () => {
      await repo.saveOmadaClientMap(customerId, mac)
      await refreshClients()
      const name = customers.find((c) => c.id === customerId)?.name || 'customer'
      return customerId ? `Mapped ${mac} to ${name}.` : `Unmapped ${mac}.`
    })
  }

  const cfg = status?.config ?? EMPTY_CONFIG
  const phase = phaseOf(status, connecting)
  const connected = phase === 'connected'
  const hw = hardwareVersion.trim() || DEFAULT_OMADA_HW
  const fw = firmwareVersion.trim() || DEFAULT_OMADA_FW
  const clientRows = useMemo(
    () => (showWired ? clients : clients.filter((row) => row.wireless || row.likelyCpe || row.blocked || row.customerId)),
    [clients, showWired],
  )

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">TP-Link Omada</p>
          <h1>Manage ER7206</h1>
          <p className="muted">
            Hardware {hw} · firmware {fw} · controller 5.13+. The ER7206 is the site gateway and stays up. House CPEs
            associate wirelessly to Omada APs — disconnect that CPE station to suspend a location, never the ER7206 WAN
            and never phones behind the CPE.
          </p>
        </div>
      </header>

      <section className={`card omada-status is-${phase}`}>
        <p className="eyebrow">Status</p>
        <p className="omada-state-label">{phaseLabel(phase)}</p>
        <p className="muted">
          {connected ? 'Gateway online in Omada' : phase === 'connecting' ? 'Talking to the controller…' : 'Gateway not online yet'}
          {' · '}HW {hw} · FW {fw}
        </p>
        <ul className="omada-flags">
          {flag(status?.controllerOk, 'Controller reachable')}
          {flag(status?.loginOk, 'Login OK')}
          {flag(status?.siteFound, 'Site found')}
          {flag(status?.deviceFound, 'ER7206 MAC found')}
          {flag(status?.deviceOnline, 'Gateway online')}
        </ul>
        {status?.deviceName && (
          <p className="muted tiny">
            {status.deviceName}
            {status.ip ? ` · ${status.ip}` : ''}
          </p>
        )}
      </section>

      <form className="card" onSubmit={save}>
        <div className="card-head">
          <h2>Connection</h2>
        </div>
        <p className="muted tiny">
          Tunnel hostname only (https://omada.example.com). Dedicated Omada API user. After the first deploy, hard-refresh
          /ops/ then Test connection. Password is never echoed back.
        </p>
        <label>
          Controller URL
          <input
            value={controllerUrl}
            onChange={(e) => setControllerUrl(e.target.value)}
            placeholder="https://omada.example.com"
            autoComplete="off"
            required
          />
        </label>
        <div className="form-row">
          <label>
            Omada username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Omada password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={cfg.passwordSaved ? `Saved · last 4 ${cfg.passwordLast4 || '••••'}` : 'Required'}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Site name
            <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Default" />
          </label>
          <label>
            ER7206 MAC
            <input value={deviceMac} onChange={(e) => setDeviceMac(e.target.value)} placeholder="AA-BB-CC-DD-EE-FF" required />
          </label>
        </div>
        <div className="form-row">
          <label>
            Cloudflare Access Client ID
            <input
              value={cfAccessClientId}
              onChange={(e) => setCfAccessClientId(e.target.value)}
              placeholder="Optional — CF-Access-Client-Id"
              autoComplete="off"
            />
          </label>
          <label>
            Cloudflare Access Client Secret
            <input
              type="password"
              value={cfAccessClientSecret}
              onChange={(e) => setCfAccessClientSecret(e.target.value)}
              placeholder={
                cfg.cfAccessSecretSaved ? `Saved · last 4 ${cfg.cfAccessSecretLast4 || '••••'}` : 'Optional — CF-Access-Client-Secret'
              }
              autoComplete="new-password"
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Hardware version
            <input value={hardwareVersion} onChange={(e) => setHardwareVersion(e.target.value)} />
          </label>
          <label>
            Firmware version
            <input value={firmwareVersion} onChange={(e) => setFirmwareVersion(e.target.value)} />
          </label>
        </div>
        <label className="toggle-field">
          <input type="checkbox" checked={allowInsecureTls} onChange={(e) => setAllowInsecureTls(e.target.checked)} />
          Allow insecure TLS (self-signed Omada cert on LAN only — do not use on the public tunnel)
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={autoSuspendOnExpire} onChange={(e) => setAutoSuspendOnExpire(e.target.checked)} />
          Auto-disconnect mapped house CPEs when a subscription expires (wireless MAC on the AP, not the gateway)
        </label>
        <div className="form-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save connection'}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void test()}>
            Test connection
          </button>
        </div>
      </form>

      <section className="card table-card">
        <div className="card-head" style={{ padding: '1.15rem 1.2rem 0' }}>
          <h2>House CPEs on APs</h2>
          <span className={`pill ${connected ? 'ok' : 'warn'}`}>{clientRows.length} wireless</span>
        </div>
        <p className="muted tiny" style={{ padding: '0 1.2rem' }}>
          Wireless stations on Omada APs (CPE / mesh / station). Map the CPE MAC to a customer, then disconnect that
          location. Wired LAN and phones behind a CPE are not the suspend target.
        </p>
        <div className="form-row" style={{ padding: '0 1.2rem 0.6rem' }}>
          <button className="btn btn-ghost" type="button" disabled={busy || !connected} onClick={() => void run(async () => {
            await refreshClients()
            return `Loaded ${clients.length} wireless clients.`
          })}>
            Refresh CPEs
          </button>
          <label className="toggle-field">
            <input type="checkbox" checked={showWired} onChange={(e) => setShowWired(e.target.checked)} />
            Show wired LAN too
          </label>
        </div>
        <table className="roster">
          <thead>
            <tr>
              <th>CPE / station</th>
              <th>AP</th>
              <th>IP / MAC</th>
              <th>Traffic</th>
              <th>Customer</th>
              <th>Line</th>
            </tr>
          </thead>
          <tbody>
            {clientRows.map((row) => (
              <tr key={row.mac}>
                <td>
                  <strong>{row.hostname || '—'}</strong>
                  <div className="muted tiny">
                    {row.likelyCpe ? 'Likely CPE' : row.wireless ? 'Wireless client' : 'LAN'}
                    {row.active ? ' · online' : ' · recent'}
                    {row.blocked ? ' · blocked' : ''}
                    {row.ssid ? ` · ${row.ssid}` : ''}
                  </div>
                </td>
                <td className="tiny">{row.apName || row.apMac || '—'}</td>
                <td className="tiny">
                  {row.ip || '—'}
                  <br />
                  {row.mac}
                </td>
                <td className="tiny">
                  ↓ {formatBytes(row.trafficDown)}
                  <br />↑ {formatBytes(row.trafficUp)}
                </td>
                <td>
                  <select
                    value={row.customerId}
                    disabled={busy}
                    onChange={(e) => mapClient(row.mac, e.target.value)}
                  >
                    <option value="">Unmapped</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.email || c.id}
                      </option>
                    ))}
                  </select>
                  {row.customerId && (
                    <div>
                      <Link className="tiny" to={`/c/${row.customerId}`}>
                        Open record
                      </Link>
                    </div>
                  )}
                </td>
                <td className="roster-actions">
                  {row.blocked ? (
                    <button className="btn btn-tiny btn-primary" type="button" disabled={busy} onClick={() => setBlocked(row, false)}>
                      Reconnect CPE
                    </button>
                  ) : (
                    <button className="btn btn-tiny danger" type="button" disabled={busy} onClick={() => setBlocked(row, true)}>
                      Disconnect CPE
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {connected && clientRows.length === 0 && (
          <p className="empty">No wireless CPE/stations yet. Confirm the site, then Refresh CPEs. Turn on “Show wired LAN too” only if Omada did not mark them wireless.</p>
        )}
        {!connected && <p className="empty">Connect the controller first. The ER7206 must show Connected before CPE actions run.</p>}
      </section>

      {msg && <p className="ok-text">{msg}</p>}
      {err && <p className="fail">{err}</p>}
    </div>
  )
}
