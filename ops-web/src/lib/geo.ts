import type { Customer, IssueTicket } from './types'

const COORD = /^\s*(-?\d{1,2}\.\d+)\s*[ ,]\s*(-?\d{1,3}\.\d+)\s*$/

export type LatLng = { lat: number; lng: number }

export function parseLatLng(value: string | null | undefined): LatLng | null {
  if (!value) return null
  const match = COORD.exec(value.trim())
  if (!match) return null
  const lat = Number(match[1])
  const lng = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

export function looksLikeCoordinates(value: string | null | undefined): boolean {
  return Boolean(parseLatLng(value))
}

export function customerPin(customer: Customer): LatLng | null {
  if (Number.isFinite(customer.lat) && Number.isFinite(customer.lng) && customer.lat != null && customer.lng != null) {
    return { lat: customer.lat, lng: customer.lng }
  }
  return parseLatLng(customer.address)
}

export function displayAddress(customer: Customer): string {
  const label = (customer.locationLabel ?? '').trim()
  if (label && !looksLikeCoordinates(label)) return label
  const address = customer.address.trim()
  if (address && !looksLikeCoordinates(address)) return address
  if (customerPin(customer)) return 'Shared pin — village name not saved yet'
  return address || 'No village on file'
}

export type PinTone = 'open' | 'ongoing' | 'resolved' | 'idle'

export function pinTone(customerId: string, issues: IssueTicket[]): PinTone {
  const theirs = issues.filter((i) => i.customerId === customerId)
  if (theirs.some((i) => i.status === 'in_progress')) return 'ongoing'
  if (theirs.some((i) => i.status === 'open')) return 'open'
  if (theirs.some((i) => i.status === 'resolved')) return 'resolved'
  return 'idle'
}

export const PIN_COLORS: Record<PinTone, string> = {
  open: '#f87171',
  ongoing: '#fbbf24',
  resolved: '#34d399',
  idle: '#22d3ee',
}

export const PIN_LABELS: Record<PinTone, string> = {
  open: 'Issue open',
  ongoing: 'Technician underway',
  resolved: 'Resolved',
  idle: 'Pin only',
}

export const ANTIGUA_CENTER: LatLng = { lat: 17.074, lng: -61.817 }
