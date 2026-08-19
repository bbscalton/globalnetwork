import { useMemo, useState } from 'react'
import {
  DEVICE_ACTIONS,
  SUPPORTED_DEVICES,
  capLabel,
  deviceSearchBlob,
  type CapLevel,
  type DeviceFamily,
  type DeviceRole,
  type SupportedDevice,
} from './lib/supportedDevices'

type BrandFilter = 'all' | DeviceFamily
type RoleFilter = 'all' | DeviceRole
type CapFilter = 'all' | 'suspend' | 'skip'

const BRAND_CHIPS: Array<[BrandFilter, string]> = [
  ['all', 'All'],
  ['mikrotik', 'MikroTik'],
  ['ubiquiti', 'Ubiquiti'],
  ['omada', 'TP-Link Omada'],
  ['openwrt', 'OpenWrt / other'],
  ['unsupported', 'Not recommended'],
]

const ROLE_CHIPS: Array<[RoleFilter, string]> = [
  ['all', 'Any use'],
  ['cpe', 'CPE'],
  ['home-router', 'Home router'],
  ['gateway', 'Gateway'],
  ['ap', 'AP'],
  ['poe-switch', 'PoE'],
]

const CAP_CHIPS: Array<[CapFilter, string]> = [
  ['all', 'Any capability'],
  ['suspend', 'Can suspend'],
  ['skip', 'Not recommended'],
]

function roleLabel(role: DeviceRole): string {
  if (role === 'home-router') return 'Home router'
  if (role === 'poe-switch') return 'PoE'
  if (role === 'cpe') return 'CPE'
  if (role === 'ap') return 'AP'
  return 'Gateway'
}

function capTone(level: CapLevel): string {
  if (level === 'yes') return 'ok'
  if (level === 'partial') return 'warn'
  if (level === 'poe') return 'poe'
  return 'fail'
}

function matches(device: SupportedDevice, term: string, brand: BrandFilter, role: RoleFilter, cap: CapFilter): boolean {
  if (brand !== 'all' && device.family !== brand) return false
  if (role !== 'all' && device.role !== role) return false
  if (cap === 'suspend' && !device.canSuspend) return false
  if (cap === 'skip' && device.recommended) return false
  if (!term) return true
  return deviceSearchBlob(device).includes(term)
}

export function DevicesDesk() {
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState<BrandFilter>('all')
  const [role, setRole] = useState<RoleFilter>('all')
  const [cap, setCap] = useState<CapFilter>('all')

  const term = q.trim().toLowerCase()
  const rows = useMemo(
    () => SUPPORTED_DEVICES.filter((device) => matches(device, term, brand, role, cap)),
    [term, brand, role, cap],
  )

  const kpis = useMemo(() => {
    const recommended = SUPPORTED_DEVICES.filter((d) => d.recommended)
    return {
      catalog: SUPPORTED_DEVICES.length,
      suspend: recommended.filter((d) => d.canSuspend).length,
      cpe: recommended.filter((d) => d.role === 'cpe').length,
      skip: SUPPORTED_DEVICES.filter((d) => !d.recommended).length,
    }
  }, [])

  const wr841 = SUPPORTED_DEVICES.find((d) => d.id === 'wr841n-v14')

  return (
    <div className="desk">
      <header className="desk-hero">
        <div>
          <p className="eyebrow">Fleet</p>
          <h1>Supported devices</h1>
          <p className="muted">
            These are devices GlobalNetwork can <em>aim</em> to manage for subscriptions — cheap CPE and home
            routers with a real management API. Remote suspend / restore is not wired yet. This page is the
            supported fleet catalog, not live router control.
          </p>
        </div>
      </header>

      {wr841 && (
        <section className="card callout-skip" role="note">
          <div className="card-head">
            <p className="eyebrow">Not supported</p>
            <span className="pill fail">Do not issue</span>
          </div>
          <h2>
            {wr841.brand} {wr841.name}
          </h2>
          <p>
            No ISP API — local web UI only. You cannot remotely suspend a subscriber on this box. Issue a hAP
            lite, hEX, Omada ER605 / ER7206, or airMAX CPE instead.
          </p>
        </section>
      )}

      <section className="queue-grid" aria-label="Catalog pulse">
        <button
          className="queue-card"
          type="button"
          onClick={() => {
            setBrand('all')
            setRole('all')
            setCap('all')
            setQ('')
          }}
        >
          <span className="queue-label">Catalog</span>
          <strong className="count-pop">{kpis.catalog}</strong>
          <span className="muted">SKUs in this lookup</span>
        </button>
        <button
          className="queue-card"
          type="button"
          onClick={() => {
            setCap('suspend')
            setBrand('all')
          }}
        >
          <span className="queue-label">Can suspend</span>
          <strong className="count-pop">{kpis.suspend}</strong>
          <span className="muted">API path to cut WAN / wireless</span>
        </button>
        <button
          className="queue-card"
          type="button"
          onClick={() => {
            setRole('cpe')
            setCap('all')
          }}
        >
          <span className="queue-label">CPE</span>
          <strong className="count-pop">{kpis.cpe}</strong>
          <span className="muted">Last-mile radios we can issue</span>
        </button>
        <button
          className="queue-card"
          type="button"
          onClick={() => {
            setCap('skip')
            setRole('all')
          }}
        >
          <span className="queue-label">Not recommended</span>
          <strong className="count-pop">{kpis.skip}</strong>
          <span className="muted">Consumer junk — no remote control</span>
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>What “manage” means</h2>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Target capabilities once an API is wired. Nothing on this desk talks to a router yet.
        </p>
        <ul className="cap-legend">
          {DEVICE_ACTIONS.map((action) => (
            <li key={action.id}>
              <strong>{action.label}</strong>
              <span className="muted">{action.blurb}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="desk-toolbar">
        <input
          className="search search-lg"
          placeholder="Search litebeam, hap, wr841, nanostation, hex, omada…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <div className="chips">
          {BRAND_CHIPS.map(([id, label]) => (
            <button key={id} type="button" className={`chip ${brand === id ? 'is-on' : ''}`} onClick={() => setBrand(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chips">
          {ROLE_CHIPS.map(([id, label]) => (
            <button key={id} type="button" className={`chip ${role === id ? 'is-on' : ''}`} onClick={() => setRole(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chips">
          {CAP_CHIPS.map(([id, label]) => (
            <button key={id} type="button" className={`chip ${cap === id ? 'is-on' : ''}`} onClick={() => setCap(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="plan-grid device-grid">
        {rows.map((device) => (
          <article key={device.id} className={`card plan-card ${device.recommended ? '' : 'is-hidden device-skip'}`}>
            <header className="card-head">
              <p className="eyebrow">{device.brand}</p>
              <span className={`pill ${device.recommended ? (device.canSuspend ? 'ok' : 'warn') : 'fail'}`}>
                {device.recommended ? (device.canSuspend ? 'Can suspend' : roleLabel(device.role)) : 'Not recommended'}
              </span>
            </header>
            <h2>{device.name}</h2>
            <p className="muted tiny">
              {device.sku} · {roleLabel(device.role)}
            </p>
            <p className="device-street">{device.streetCheap}</p>
            <p className="muted tiny">Manage via {device.manageVia}</p>
            <p>{device.notes}</p>
            <ul className="cap-list">
              {DEVICE_ACTIONS.map((action) => {
                const cell = device.caps[action.id]
                return (
                  <li key={action.id} className="cap-row">
                    <span>
                      <strong>{action.label}</strong>
                      <span className="muted tiny">{cell.detail}</span>
                    </span>
                    <span className={`pill ${capTone(cell.level)}`}>{capLabel(cell.level)}</span>
                  </li>
                )
              })}
            </ul>
          </article>
        ))}
      </div>
      {rows.length === 0 && <p className="empty">No devices match that search. Try litebeam, hap, wr841, or nanostation.</p>}
    </div>
  )
}
