export type TcdCheckStatus = 'ok' | 'warn' | 'fail'

export type TcdCheck = {
  id: string
  label: string
  group: 'platform' | 'fleet' | 'uptime'
  status: TcdCheckStatus
  message: string
  latencyMs?: number | null
  optional?: boolean
}

export type TcdReport = {
  generatedAtMs: number
  checks: TcdCheck[]
}

export type CustomerStatus = 'active' | 'grace' | 'expired' | 'suspended'

export type Customer = {
  id: string
  name: string
  phone: string
  email: string
  address: string
  status: CustomerStatus
  planId: string
  planName: string
  planDays: number
  feeAmount: number
  paidAmount: number
  balanceDue: number
  paidUntilMs: number | null
  graceUntilMs: number | null
  lastSeenMs: number
  unreadStaff?: number
  createdAtMs: number
  uid?: string | null
}

export type Plan = {
  id: string
  name: string
  days: number
  feeAmount: number
  currency: string
  active: boolean
}

export type Payment = {
  id: string
  amount: number
  kind: 'full' | 'partial' | 'grace'
  daysGranted: number
  note: string
  atMs: number
  byUid: string
}

export type ChatMessage = {
  id: string
  from: 'customer' | 'staff'
  text: string
  mediaUrl?: string | null
  createdAtMs: number
}

export type IssueTicket = {
  id: string
  customerId: string
  customerName: string
  title: string
  body: string
  status: 'open' | 'in_progress' | 'resolved'
  photoUrls: string[]
  createdAtMs: number
}

export type SiteUptime = {
  id: string
  label: string
  url: string
  status: TcdCheckStatus
  message: string
  latencyMs?: number | null
}

export type ArchNode = {
  id: string
  label: string
  group: 'client' | 'firebase' | 'edge' | 'hosting' | 'external'
  status: TcdCheckStatus
  detail?: string
  url?: string
}

export type PlatformFault = {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  source: string
}

export type TcdTab = 'overview' | 'accounts' | 'plans' | 'issues' | 'chat' | 'storage' | 'architecture' | 'system'

export type AdminAuditLogEntry = {
  id: string
  action: string
  adminEmail: string
  targetUid: string
  detail?: string
  atMs: number
}

export type StorageDump = {
  objects: number
  bytes: number
  truncated: boolean
  customers: Record<string, { bytes: number; objects: number }>
}
