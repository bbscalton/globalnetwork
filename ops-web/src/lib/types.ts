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
  /** Full package fee owed (no partial plan payments). */
  planDue: number
  /** Unpaid day-extension charges (EC$6/day stacks). */
  extensionDue: number
  /** Roster total: planDue + extensionDue. */
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
  lat?: number | null
  lng?: number | null
  locationLabel?: string
  callStatus?: 'idle' | 'ringing' | 'in_call' | 'ended' | 'missed' | string
  liveCallId?: string
  callRecording?: boolean
  omadaClientMac?: string
  cpeMac?: string
}

export type Plan = {
  id: string
  name: string
  days: number
  feeAmount: number
  currency: string
  active: boolean
}

/** Day-extension rate (XCD / EC$). Unpaid stacks on extensionDue. Balance = planDue + extensionDue. */
export const DAY_EXTENSION_RATE_XCD = 6

/** Legacy partial kept for old ledger rows; new plan collects are always `full`. */
export type PaymentKind = 'full' | 'partial' | 'grace' | 'adjust' | 'extension'

export type Payment = {
  id: string
  customerId?: string
  customerName?: string
  amount: number
  kind: PaymentKind
  daysGranted: number
  note: string
  atMs: number
  byUid: string
  balanceAdded?: number
  locationId?: string
  locationName?: string
  collectedByUid?: string
  collectedByEmail?: string
  channel?: string
  paidNow?: boolean
}

export type PosOutlet = {
  id: string
  name: string
  disabled: boolean
  createdAtMs: number
}

export const OWNER_DESK_OUTLET: PosOutlet = {
  id: 'owner-desk',
  name: 'Owner desk',
  disabled: false,
  createdAtMs: 0,
}

export const DEFAULT_POS_LOCATIONS: PosOutlet[] = [
  { id: 'all-saints', name: 'All Saints', disabled: false, createdAtMs: 0 },
  { id: 'potters', name: 'Potters', disabled: false, createdAtMs: 0 },
  { id: 'bolans', name: 'Bolans', disabled: false, createdAtMs: 0 },
  { id: 'jennings', name: 'Jennings', disabled: false, createdAtMs: 0 },
  { id: 'st-johns', name: "St. John's", disabled: false, createdAtMs: 0 },
]

export type ChatMessage = {
  id: string
  from: 'customer' | 'owner' | 'bot'
  text: string
  kind?: 'text' | 'voice' | 'video' | string
  mediaUrl?: string | null
  durationMs?: number
  createdAtMs: number
  editedAtMs?: number
  lat?: number | null
  lng?: number | null
}

export type OrgSettings = {
  name: string
  currency: string
  supportPhone: string
  supportWhatsapp: string
  botEnabled: boolean
  callRecordingDefault: boolean
  renewalWarnDays: number
  timezone: string
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  name: 'GlobalNetwork',
  currency: 'XCD',
  supportPhone: '',
  supportWhatsapp: '',
  botEnabled: true,
  callRecordingDefault: false,
  renewalWarnDays: 3,
  timezone: 'America/Antigua',
}

export type VoiceCall = {
  id: string
  customerId?: string
  from: 'customer' | 'owner'
  status: 'ringing' | 'in_call' | 'ended' | 'missed' | string
  offerSdp: string
  answerSdp: string
  recording: boolean
  recordingUrl?: string | null
  durationMs?: number
  startedAtMs: number
  answeredAtMs?: number
  endedAtMs?: number
  endedBy?: 'customer' | 'owner' | string
  videoActive?: boolean
  offerFrom?: 'customer' | 'owner' | string
  negotiationGen?: number
  ownerVideoVisible?: boolean
}

export type DeskRole = 'owner' | 'manager' | 'cashier' | 'pending' | 'rejected'

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
  outletIds: string[]
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

export type OmadaPublicConfig = {
  controllerUrl: string
  username: string
  passwordSaved: boolean
  passwordLast4: string
  siteName: string
  deviceMac: string
  cfAccessClientId: string
  cfAccessSecretSaved: boolean
  cfAccessSecretLast4: string
  hardwareVersion: string
  firmwareVersion: string
  allowInsecureTls: boolean
  autoSuspendOnExpire: boolean
}

export const DEFAULT_OMADA_HW = '1.0'
export const DEFAULT_OMADA_FW = '1.4.2'

export type OmadaStatus = {
  ok: boolean
  connected: boolean
  controllerOk: boolean
  loginOk: boolean
  siteFound: boolean
  deviceFound: boolean
  deviceOnline: boolean
  deviceName: string
  ip: string
  status: string
  hardwareVersion: string
  firmwareVersion: string
  error: string
  config: OmadaPublicConfig
}

export type OmadaClientRow = {
  mac: string
  ip: string
  hostname: string
  blocked: boolean
  active: boolean
  trafficDown: number
  trafficUp: number
  lastSeenMs: number
  gatewayMac: string
  customerId: string
  customerName: string
  wireless: boolean
  apName: string
  apMac: string
  ssid: string
  deviceType: string
  likelyCpe: boolean
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
