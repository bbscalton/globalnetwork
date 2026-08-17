import type { Customer, CustomerStatus, IssueTicket } from './types'
import { daysLeft } from './repo'

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtWhen(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'GN'
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function statusTone(status: CustomerStatus): 'ok' | 'warn' | 'fail' {
  if (status === 'active') return 'ok'
  if (status === 'grace') return 'warn'
  return 'fail'
}

export function cyclePct(customer: Customer, now: number): number {
  const left = Math.max(0, daysLeft(customer.paidUntilMs, now))
  const span = Math.max(customer.planDays || 1, 1)
  return Math.max(0, Math.min(100, Math.round((left / span) * 100)))
}

export type DeskPulse = {
  total: number
  active: number
  grace: number
  expired: number
  suspended: number
  dueSoon: Customer[]
  collections: Customer[]
  unread: Customer[]
  offline: Customer[]
  openIssues: number
  applications: Customer[]
  ringing: number
}

export function deskPulse(customers: Customer[], issues: IssueTicket[], now: number, onlineAfterMs: number): DeskPulse {
  const dueSoon = customers
    .filter((c) => {
      const left = daysLeft(c.paidUntilMs, now)
      return left > 0 && left <= 3 && c.status !== 'suspended'
    })
    .sort((a, b) => daysLeft(a.paidUntilMs, now) - daysLeft(b.paidUntilMs, now))
  const collections = customers.filter((c) => (c.balanceDue || 0) > 0 || c.status === 'grace')
  const unread = customers.filter((c) => (c.unreadStaff ?? 0) > 0)
  const offline = customers.filter((c) => c.status === 'active' && (!c.lastSeenMs || now - c.lastSeenMs > onlineAfterMs))
  const applications = customers.filter((c) => c.approvalStatus === 'pending')
  return {
    total: customers.length,
    active: customers.filter((c) => c.status === 'active').length,
    grace: customers.filter((c) => c.status === 'grace').length,
    expired: customers.filter((c) => c.status === 'expired').length,
    suspended: customers.filter((c) => c.status === 'suspended').length,
    dueSoon,
    collections,
    unread,
    offline,
    openIssues: issues.filter((i) => i.status !== 'resolved').length,
    applications,
    ringing: customers.filter((c) => c.callStatus === 'ringing' || c.callStatus === 'in_call').length,
  }
}
