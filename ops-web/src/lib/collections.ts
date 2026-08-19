import { OWNER_DESK_OUTLET, type Payment, type PosOutlet } from './types'

const TZ = 'America/Antigua'

function ymdInAntigua(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

export function antiguaDayStart(now: number): number {
  return Date.parse(`${ymdInAntigua(now)}T00:00:00-04:00`)
}

export function antiguaMonthStart(now: number): number {
  const ymd = ymdInAntigua(now)
  return Date.parse(`${ymd.slice(0, 7)}-01T00:00:00-04:00`)
}

export function isCashCollection(p: Payment): boolean {
  return p.amount > 0 && p.kind !== 'extension' && p.kind !== 'adjust'
}

export type OutletStats = {
  id: string
  name: string
  disabled: boolean
  today: number
  month: number
  all: number
  count: number
  lastAtMs: number
  lastAmount: number
}

export type CollectionRollup = {
  today: number
  month: number
  all: number
  count: number
  last: Payment | null
  byOutlet: OutletStats[]
}

export function rollupCollections(payments: Payment[], outlets: PosOutlet[], now: number): CollectionRollup {
  const cash = payments.filter(isCashCollection)
  const day0 = antiguaDayStart(now)
  const month0 = antiguaMonthStart(now)
  const map = new Map<string, OutletStats>()

  const ensure = (id: string, name: string, disabled = false) => {
    const key = id || 'unassigned'
    const existing = map.get(key)
    if (existing) return existing
    const row: OutletStats = {
      id: key,
      name: name || 'Unassigned',
      disabled,
      today: 0,
      month: 0,
      all: 0,
      count: 0,
      lastAtMs: 0,
      lastAmount: 0,
    }
    map.set(key, row)
    return row
  }

  ensure(OWNER_DESK_OUTLET.id, OWNER_DESK_OUTLET.name)
  for (const o of outlets) ensure(o.id, o.name, o.disabled)

  for (const p of cash) {
    const id = p.locationId || OWNER_DESK_OUTLET.id
    const name = p.locationName || (id === OWNER_DESK_OUTLET.id ? OWNER_DESK_OUTLET.name : 'Unassigned')
    const row = ensure(id, name)
    row.all += p.amount
    row.count += 1
    if (p.atMs >= month0) row.month += p.amount
    if (p.atMs >= day0) row.today += p.amount
    if (p.atMs > row.lastAtMs) {
      row.lastAtMs = p.atMs
      row.lastAmount = p.amount
    }
  }

  const byOutlet = [...map.values()].sort((a, b) => b.all - a.all || a.name.localeCompare(b.name))
  return {
    today: cash.filter((p) => p.atMs >= day0).reduce((s, p) => s + p.amount, 0),
    month: cash.filter((p) => p.atMs >= month0).reduce((s, p) => s + p.amount, 0),
    all: cash.reduce((s, p) => s + p.amount, 0),
    count: cash.length,
    last: cash[0] ?? null,
    byOutlet,
  }
}
