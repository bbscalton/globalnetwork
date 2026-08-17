import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Customer, IssueTicket } from './lib/types'
import { ANTIGUA_CENTER, PIN_COLORS, PIN_LABELS, customerPin, displayAddress, pinTone, type PinTone } from './lib/geo'

const IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const STREETS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

function esc(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch)
}

function markerIcon(tone: PinTone) {
  return L.divIcon({
    className: 'gn-pin',
    html: `<span class="gn-pin-dot" style="background:${PIN_COLORS[tone]}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  })
}

export function FieldMap({ customers, issues }: { customers: Customer[]; issues: IssueTicket[] }) {
  const [params, setParams] = useSearchParams()
  const selected = params.get('c') || ''
  const [basemap, setBasemap] = useState<'sat' | 'osm'>('sat')
  const [filter, setFilter] = useState<'all' | PinTone>('all')
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)

  const pins = useMemo(() => {
    return customers
      .map((customer) => {
        const at = customerPin(customer)
        if (!at) return null
        const tone = pinTone(customer.id, issues)
        return { customer, at, tone }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => (filter === 'all' ? true : row.tone === filter))
  }, [customers, issues, filter])

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, { zoomControl: true, scrollWheelZoom: true }).setView(
      [ANTIGUA_CENTER.lat, ANTIGUA_CENTER.lng],
      12,
    )
    mapRef.current = map
    layersRef.current = L.layerGroup().addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const old = (map as L.Map & { _gnBase?: L.Layer[] })._gnBase
    old?.forEach((layer) => map.removeLayer(layer))
    const next: L.Layer[] = []
    if (basemap === 'sat') {
      next.push(
        L.tileLayer(IMAGERY, {
          maxZoom: 19,
          attribution: 'Satellite © Esri · places © OpenStreetMap',
        }).addTo(map),
      )
      next.push(L.tileLayer(LABELS, { maxZoom: 19, pane: 'overlayPane' }).addTo(map))
    } else {
      next.push(
        L.tileLayer(STREETS, {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
        }).addTo(map),
      )
    }
    ;(map as L.Map & { _gnBase?: L.Layer[] })._gnBase = next
  }, [basemap])

  useEffect(() => {
    const map = mapRef.current
    const group = layersRef.current
    if (!map || !group) return
    group.clearLayers()
    const bounds: L.LatLngExpression[] = []
    for (const row of pins) {
      const marker = L.marker([row.at.lat, row.at.lng], { icon: markerIcon(row.tone) })
      const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${row.at.lat},${row.at.lng}`
      marker.bindPopup(`
        <div class="gn-pop">
          <strong>${esc(row.customer.name || 'Customer')}</strong>
          <div>${esc(displayAddress(row.customer))}</div>
          <div class="tone" style="color:${PIN_COLORS[row.tone]}">${PIN_LABELS[row.tone]}</div>
          <a href="${import.meta.env.BASE_URL}chat?c=${row.customer.id}">Open chat</a>
          · <a href="${gmaps}" target="_blank" rel="noreferrer">Navigate</a>
        </div>
      `)
      if (selected === row.customer.id) marker.setZIndexOffset(600)
      marker.addTo(group)
      bounds.push([row.at.lat, row.at.lng])
    }
    if (selected) {
      const hit = pins.find((row) => row.customer.id === selected)
      if (hit) map.setView([hit.at.lat, hit.at.lng], 16)
    } else if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds).pad(0.18))
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15)
    }
  }, [pins, selected])

  return (
    <div className="desk field-desk">
      <header className="desk-hero compact">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1>Field map</h1>
          <p className="muted">
            Pins from shared location. Satellite is the default so a technician can read the roof and driveway. Red still
            needs a visit, yellow is underway, green is resolved.
          </p>
        </div>
      </header>
      <div className="desk-toolbar">
        <div className="chips">
          {(
            [
              ['sat', 'Satellite'],
              ['osm', 'OSM streets'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={`chip ${basemap === id ? 'is-on' : ''}`} onClick={() => setBasemap(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chips">
          {(
            [
              ['all', 'All pins'],
              ['open', 'Open · red'],
              ['ongoing', 'Ongoing · yellow'],
              ['resolved', 'Resolved · green'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={`chip ${filter === id ? 'is-on' : ''}`} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field-split">
        <div ref={mapEl} className="field-map" />
        <aside className="card field-list">
          <div className="card-head">
            <h2>Sites</h2>
            <span className="muted tiny">{pins.length}</span>
          </div>
          {pins.length === 0 && <p className="muted">Nobody has shared a pin yet. The bot will ask in chat.</p>}
          {pins.map((row) => (
            <button
              key={row.customer.id}
              type="button"
              className={`field-row ${selected === row.customer.id ? 'is-on' : ''}`}
              onClick={() => setParams({ c: row.customer.id })}
            >
              <span className="gn-pin-dot" style={{ background: PIN_COLORS[row.tone] }} />
              <span>
                <strong>{row.customer.name || 'Unnamed'}</strong>
                <div className="muted tiny">{displayAddress(row.customer)}</div>
              </span>
              <Link to={`/chat?c=${row.customer.id}`} onClick={(e) => e.stopPropagation()}>
                Chat
              </Link>
            </button>
          ))}
          <p className="muted tiny">Cyan pins have a location but no open ticket.</p>
        </aside>
      </div>
    </div>
  )
}
