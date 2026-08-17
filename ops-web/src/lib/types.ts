export type CustomerStatus = 'active' | 'grace' | 'expired' | 'suspended'
export type ApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected' | ''

export type Customer = {
  id: string
  name: string
  phone: string
  email: string
  address: string
  status: CustomerStatus
  approvalStatus: ApprovalStatus
  rejectionReason: string
  idPhotoUrl: string
  billingPhotoUrl: string
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
  chatAgentLive?: boolean
  lastChatPreview?: string
  lastChatAtMs?: number
  lastChatKind?: string
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
  from: 'customer' | 'owner' | 'bot'
  text: string
  kind?: 'text' | 'voice' | 'video' | string
  mediaUrl?: string | null
  durationMs?: number
  createdAtMs: number
}

export type DeskRole = 'owner' | 'pending' | 'rejected'

export type DeskMember = {
  id: string
  uid: string
  email: string
  name: string
  role: DeskRole
  isPrimary: boolean
  rejectedReason: string
  requestedAtMs: number
  approvedAtMs: number
  lastSeenMs: number
}

export type DeskInvite = {
  id: string
  email: string
  name: string
  role: string
  status: string
  invitedBy: string
  invitedAtMs: number
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
