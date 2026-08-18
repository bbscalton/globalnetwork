import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { COL, auth, db, functions } from './firebase'
import { ORG_ID, R2_BASE } from './admin'
import { DAY_EXTENSION_RATE_XCD, DEFAULT_ORG_SETTINGS, type ChatMessage, type Customer, type CustomerStatus, type DeskInvite, type DeskMember, type DeskRole, type IssueTicket, type OrgSettings, type Payment, type PaymentKind, type Plan, type VoiceCall } from './types'

export { DAY_EXTENSION_RATE_XCD }

function requireDb() {
  if (!db) throw new Error('Firestore is not configured.')
  return db
}

function asCustomer(id: string, data: Record<string, unknown>): Customer {
  return {
    id,
    name: String(data.name ?? ''),
    phone: String(data.phone ?? ''),
    email: String(data.email ?? ''),
    address: String(data.address ?? ''),
    status: (data.status as CustomerStatus) || 'expired',
    planId: String(data.planId ?? ''),
    planName: String(data.planName ?? ''),
    planDays: Number(data.planDays ?? 30),
    feeAmount: Number(data.feeAmount ?? 0),
    paidAmount: Number(data.paidAmount ?? 0),
    balanceDue: Number(data.balanceDue ?? 0),
    paidUntilMs: data.paidUntilMs == null ? null : Number(data.paidUntilMs),
    graceUntilMs: data.graceUntilMs == null ? null : Number(data.graceUntilMs),
    lastSeenMs: Number(data.lastSeenMs ?? 0),
    unreadStaff: Number(data.unreadStaff ?? 0),
    createdAtMs: Number(data.createdAtMs ?? 0),
    uid: data.uid == null ? null : String(data.uid),
    approvalStatus: (data.approvalStatus as Customer['approvalStatus']) || '',
    rejectionReason: String(data.rejectionReason ?? ''),
    idPhotoUrl: String(data.idPhotoUrl ?? ''),
    billingPhotoUrl: String(data.billingPhotoUrl ?? ''),
    chatAgentLive: data.chatAgentLive === true,
    lastChatPreview: String(data.lastChatPreview ?? ''),
    lastChatAtMs: Number(data.lastChatAtMs ?? 0),
    lastChatKind: String(data.lastChatKind ?? ''),
    lat: data.lat == null || data.lat === '' ? null : Number(data.lat),
    lng: data.lng == null || data.lng === '' ? null : Number(data.lng),
    locationLabel: String(data.locationLabel ?? ''),
    callStatus: String(data.callStatus ?? 'idle'),
    liveCallId: String(data.liveCallId ?? ''),
    callRecording: data.callRecording === true,
  }
}

export function isOwnerSender(from: string): boolean {
  return from === 'owner' || from === 'staff'
}

export function observeCustomers(orgId: string, onData: (rows: Customer[]) => void, onError?: (e: Error) => void): Unsubscribe {
  const database = requireDb()
  const q = query(collection(database, COL.customers), orderBy('createdAtMs', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>
        return { customer: asCustomer(d.id, data), org: String(data.orgId ?? orgId) }
      })
      onData(rows.filter((r) => !orgId || r.org === orgId).map((r) => r.customer))
    },
    (e) => onError?.(e),
  )
}

export function observeOrg(orgId: string, onData: (row: OrgSettings | null) => void, onError?: (e: Error) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(
    doc(database, COL.orgs, orgId || ORG_ID),
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      const data = snap.data() as Record<string, unknown>
      onData({
        name: String(data.name ?? DEFAULT_ORG_SETTINGS.name),
        currency: String(data.currency ?? DEFAULT_ORG_SETTINGS.currency),
        supportPhone: String(data.supportPhone ?? ''),
        supportWhatsapp: String(data.supportWhatsapp ?? ''),
        botEnabled: data.botEnabled !== false,
        callRecordingDefault: data.callRecordingDefault === true,
        renewalWarnDays: Math.max(1, Math.min(30, Number(data.renewalWarnDays ?? DEFAULT_ORG_SETTINGS.renewalWarnDays) || 3)),
        timezone: String(data.timezone ?? DEFAULT_ORG_SETTINGS.timezone) || DEFAULT_ORG_SETTINGS.timezone,
      })
    },
    (e) => onError?.(e),
  )
}

export function observePlans(onData: (rows: Plan[]) => void, onError?: (e: Error) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(
    collection(database, COL.plans),
    (snap) => {
      onData(
        snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            name: String(data.name ?? ''),
            days: Number(data.days ?? 30),
            feeAmount: Number(data.feeAmount ?? 0),
            currency: String(data.currency ?? 'XCD'),
            active: data.active !== false,
          }
        }),
      )
    },
    (e) => onError?.(e),
  )
}

export function observeChat(customerId: string, onData: (rows: ChatMessage[]) => void): Unsubscribe {
  const database = requireDb()
  const q = query(collection(database, COL.customers, customerId, COL.chatMessages), orderBy('createdAtMs', 'asc'))
  return onSnapshot(q, (snap) => {
    onData(
      snap.docs.map((d) => {
        const data = d.data()
        const fromRaw = String(data.from ?? 'customer')
        return {
          id: d.id,
          from: fromRaw === 'bot' ? 'bot' : isOwnerSender(fromRaw) ? 'owner' : 'customer',
          text: String(data.text ?? ''),
          kind: String(data.kind ?? 'text'),
          mediaUrl: data.mediaUrl == null ? null : String(data.mediaUrl),
          durationMs: Number(data.durationMs ?? 0),
          createdAtMs: Number(data.createdAtMs ?? 0),
          editedAtMs: data.editedAtMs == null ? undefined : Number(data.editedAtMs),
          lat: data.lat == null ? null : Number(data.lat),
          lng: data.lng == null ? null : Number(data.lng),
        }
      }),
    )
  })
}

export function observePayments(customerId: string, onData: (rows: Payment[]) => void): Unsubscribe {
  const database = requireDb()
  const q = query(collection(database, COL.customers, customerId, COL.payments), orderBy('atMs', 'desc'))
  return onSnapshot(q, (snap) => {
    onData(
      snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          amount: Number(data.amount ?? 0),
          kind: paymentKind(data.kind),
          daysGranted: Number(data.daysGranted ?? 0),
          note: String(data.note ?? ''),
          atMs: Number(data.atMs ?? 0),
          byUid: String(data.byUid ?? ''),
          balanceAdded: Number(data.balanceAdded ?? 0),
        }
      }),
    )
  })
}

export async function setIssueStatus(
  customerId: string,
  issueId: string,
  status: IssueTicket['status'],
): Promise<void> {
  await updateDoc(doc(requireDb(), COL.customers, customerId, COL.issues, issueId), { status })
}

export function observeIssues(onData: (rows: IssueTicket[]) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(collection(database, COL.customers), async (custSnap) => {
    const tickets: IssueTicket[] = []
    for (const c of custSnap.docs) {
      const issues = await getDocs(query(collection(c.ref, COL.issues), orderBy('createdAtMs', 'desc')))
      for (const i of issues.docs) {
        const data = i.data()
        tickets.push({
          id: i.id,
          customerId: c.id,
          customerName: String(c.data().name ?? ''),
          title: String(data.title ?? ''),
          body: String(data.body ?? ''),
          status: (data.status as IssueTicket['status']) || 'open',
          photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls.map(String) : [],
          createdAtMs: Number(data.createdAtMs ?? 0),
        })
      }
    }
    tickets.sort((a, b) => b.createdAtMs - a.createdAtMs)
    onData(tickets)
  })
}

export async function sendChat(customerId: string, text: string, from: 'owner' | 'customer' | 'bot' = 'owner'): Promise<void> {
  const database = requireDb()
  await addDoc(collection(database, COL.customers, customerId, COL.chatMessages), {
    from,
    text,
    kind: 'text',
    createdAtMs: Date.now(),
  })
  if (from === 'owner') {
    await updateDoc(doc(database, COL.customers, customerId), { chatAgentLive: true })
  }
}

export async function setChatAgentLive(customerId: string, live: boolean): Promise<void> {
  const database = requireDb()
  await updateDoc(doc(database, COL.customers, customerId), { chatAgentLive: live })
  await addDoc(collection(database, COL.customers, customerId, COL.chatMessages), {
    from: live ? 'owner' : 'bot',
    text: live
      ? 'A live GlobalNetwork agent has joined. The desk bot is stepping back.'
      : 'The live agent stepped back. I will keep covering until someone takes over again.',
    kind: 'text',
    createdAtMs: Date.now(),
  })
}

export async function createIssue(customerId: string, title: string, body: string): Promise<void> {
  await addDoc(collection(requireDb(), COL.customers, customerId, COL.issues), {
    title,
    body,
    status: 'open',
    photoUrls: [],
    createdAtMs: Date.now(),
  })
}

export async function markChatRead(customerId: string): Promise<void> {
  await updateDoc(doc(requireDb(), COL.customers, customerId), { unreadStaff: 0 })
}

export async function updateCustomerContact(
  customerId: string,
  patch: { name?: string; phone?: string; email?: string; address?: string; planId?: string; planName?: string; planDays?: number; feeAmount?: number },
): Promise<void> {
  const database = requireDb()
  await updateDoc(doc(database, COL.customers, customerId), {
    ...patch,
    ...(patch.email != null ? { email: patch.email.trim().toLowerCase() } : {}),
  })
}

async function callable<Req extends object, Res>(name: string, data: Req): Promise<Res> {
  if (!functions) throw new Error('Cloud Functions are not configured.')
  try {
    const fn = httpsCallable<Req, Res>(functions, name)
    const res = await fn(data)
    return res.data
  } catch (err) {
    throw new Error(callableMessage(err))
  }
}

function callableMessage(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return err instanceof Error ? err.message : 'Request failed'
  }
  const e = err as { code?: string; message?: string; details?: unknown }
  const code = String(e.code ?? '')
  let message = String(e.message ?? '').replace(/^FirebaseError:\s*/i, '').trim()
  if (typeof e.details === 'string' && e.details.trim()) message = e.details.trim()
  if (code === 'functions/not-found' || message === 'NOT_FOUND') {
    return `${message || 'NOT_FOUND'} — this Cloud Function is not deployed. Run firebase deploy --only functions.`
  }
  if (code === 'functions/unimplemented' || message === 'UNIMPLEMENTED') {
    return `${message || 'UNIMPLEMENTED'} — deploy Cloud Functions before using this action.`
  }
  if (message) return message
  if (code) return code
  return 'Request failed'
}

export async function createCustomer(input: {
  name: string
  phone: string
  email: string
  address: string
  planId: string
}): Promise<{ customerId: string }> {
  return callable('createCustomer', { ...input, orgId: ORG_ID })
}

export async function extendSubscription(input: {
  customerId: string
  days: number
  amountPaid: number
  note: string
}): Promise<{ paidUntilMs: number; status: CustomerStatus; balanceDue: number }> {
  return callable('extendSubscription', input)
}

export async function grantDayExtension(input: {
  customerId: string
  days: number
  note?: string
}): Promise<{ paidUntilMs: number; status: CustomerStatus; balanceDue: number; balanceAdded: number; daysGranted: number }> {
  return callable('grantDayExtension', input)
}

function paymentKind(raw: unknown): PaymentKind {
  const kind = String(raw ?? '')
  if (kind === 'partial' || kind === 'grace' || kind === 'adjust' || kind === 'extension') return kind
  return 'full'
}

export async function reviewCustomerApplication(
  customerId: string,
  decision: 'approved' | 'rejected',
  reason = '',
): Promise<void> {
  await callable('reviewCustomerApplication', { customerId, decision, reason })
}

export async function suspendCustomer(customerId: string): Promise<void> {
  await callable('suspendCustomer', { customerId })
}

export async function savePlan(plan: Omit<Plan, 'id'> & { id?: string }): Promise<void> {
  await callable('savePlan', plan)
}

export async function saveOrgSettings(input: Partial<OrgSettings> & { orgId?: string }): Promise<void> {
  await callable('saveOrgSettings', { ...input, orgId: input.orgId ?? ORG_ID })
}

export async function adjustSubscription(input: {
  customerId: string
  daysRemaining?: number
  addDays?: number
  paidUntilMs?: number | null
  status?: CustomerStatus
  note?: string
}): Promise<{ paidUntilMs: number | null; status: CustomerStatus; daysRemaining: number }> {
  return callable('adjustSubscription', input)
}

export async function unsuspendCustomer(customerId: string): Promise<{ ok: boolean; status: CustomerStatus }> {
  return callable('unsuspendCustomer', { customerId })
}

export async function deletePlan(id: string, force = false): Promise<{ ok: boolean; unassigned: number }> {
  return callable('deletePlan', { id, force })
}

export async function deleteCustomer(customerId: string): Promise<void> {
  await callable('deleteCustomer', { customerId })
}

export async function clearCustomerChat(customerId: string): Promise<{ deleted: number }> {
  return callable('clearCustomerChat', { customerId })
}

export async function deleteChatMessage(customerId: string, messageId: string): Promise<void> {
  await callable('deleteChatMessage', { customerId, messageId })
}

export async function updateChatMessage(customerId: string, messageId: string, text: string): Promise<void> {
  await callable('updateChatMessage', { customerId, messageId, text })
}

export async function deleteIssue(customerId: string, issueId: string): Promise<void> {
  await callable('deleteIssue', { customerId, issueId })
}

export async function updateIssue(
  customerId: string,
  issueId: string,
  patch: { title?: string; body?: string; status?: IssueTicket['status'] },
): Promise<void> {
  await callable('updateIssue', { customerId, issueId, ...patch })
}

export async function deletePayment(customerId: string, paymentId: string): Promise<void> {
  await callable('deletePayment', { customerId, paymentId })
}

export type FactoryResetResult = {
  ok: boolean
  customersDeleted: number
  plansDeleted: number
  auditLogsDeleted: number
  invitesDeleted: number
  adminConfigDeleted: number
}

export async function factoryReset(confirm: string): Promise<FactoryResetResult> {
  return callable('factoryReset', { confirm, orgId: ORG_ID })
}

export type TidyAction =
  | 'clearAllChats'
  | 'deleteResolvedIssues'
  | 'deleteAllIssues'
  | 'deleteOldChat'
  | 'purgeCalls'
  | 'purgeAuditLogs'
  | 'deleteRejectedCustomers'
  | 'deleteMediaMessages'

export type TidyResult = {
  ok: boolean
  action: TidyAction | string
  deleted: number
  scanned: number
  customersDeleted?: number
  olderThanDays?: number
  detail?: string
}

export async function tidyDesk(input: {
  action: TidyAction
  customerId?: string
  olderThanDays?: number
  confirm?: string
}): Promise<TidyResult> {
  return callable('tidyDesk', input)
}

export function isStaleCustomer(c: Customer, now = Date.now(), olderThanDays = 30): boolean {
  if (c.approvalStatus === 'rejected') return true
  if (c.uid) return false
  if ((c.paidUntilMs ?? 0) > now) return false
  if (c.status !== 'expired' && c.status !== 'suspended') return false
  if (!c.createdAtMs) return false
  return c.createdAtMs < now - Math.max(1, olderThanDays) * 24 * 60 * 60 * 1000
}

export async function ensureOrgDefaults(): Promise<void> {
  await callable('ensureOrgDefaults', { orgId: ORG_ID })
}

export async function registerOwnerDevice(fcmToken?: string): Promise<void> {
  await callable('registerOwnerDevice', { orgId: ORG_ID, fcmToken: fcmToken ?? '' })
}

export async function linkDeskAccount(): Promise<{ role: DeskRole; email: string; name?: string; reason?: string }> {
  return callable('linkDeskAccount', {})
}

export async function inviteDeskOwner(email: string, name = ''): Promise<void> {
  await callable('inviteDeskOwner', { email, name })
}

export async function reviewDeskMember(uid: string, decision: 'approved' | 'rejected', reason = ''): Promise<void> {
  await callable('reviewDeskMember', { uid, decision, reason })
}

export async function removeDeskOwner(uid: string): Promise<void> {
  await callable('removeDeskOwner', { uid })
}

export async function revokeDeskInvite(email: string): Promise<void> {
  await callable('revokeDeskInvite', { email })
}

function asMember(id: string, data: Record<string, unknown>): DeskMember {
  const roleRaw = String(data.role ?? 'pending')
  const role: DeskRole = roleRaw === 'owner' || roleRaw === 'rejected' ? roleRaw : 'pending'
  return {
    id,
    uid: String(data.uid ?? id),
    email: String(data.email ?? ''),
    name: String(data.name ?? ''),
    role,
    isPrimary: data.isPrimary === true,
    rejectedReason: String(data.rejectedReason ?? ''),
    requestedAtMs: Number(data.requestedAtMs ?? 0),
    approvedAtMs: Number(data.approvedAtMs ?? 0),
    lastSeenMs: Number(data.lastSeenMs ?? 0),
  }
}

export function observeDeskMember(uid: string, onData: (row: DeskMember | null) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(doc(database, COL.deskMembers, uid), (snap) => {
    onData(snap.exists() ? asMember(snap.id, snap.data() as Record<string, unknown>) : null)
  })
}

export function observeDeskMembers(onData: (rows: DeskMember[]) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(collection(database, COL.deskMembers), (snap) => {
    onData(snap.docs.map((d) => asMember(d.id, d.data() as Record<string, unknown>)))
  })
}

export function observeDeskInvites(onData: (rows: DeskInvite[]) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(collection(database, COL.deskInvites), (snap) => {
    onData(
      snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          email: String(data.email ?? d.id),
          name: String(data.name ?? ''),
          role: String(data.role ?? 'owner'),
          status: String(data.status ?? 'open'),
          invitedBy: String(data.invitedBy ?? ''),
          invitedAtMs: Number(data.invitedAtMs ?? 0),
        }
      }),
    )
  })
}

export function formatEc(amount: number): string {
  return `EC$${amount.toLocaleString()}`
}

export function daysLeft(paidUntilMs: number | null, now: number): number {
  if (!paidUntilMs) return 0
  return Math.ceil((paidUntilMs - now) / (24 * 60 * 60 * 1000))
}

export type IceServer = { urls: string | string[]; username?: string; credential?: string }

export async function fetchIceServers(): Promise<IceServer[]> {
  const stun: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
  try {
    const token = await auth?.currentUser?.getIdToken()
    if (!token) return stun
    const res = await fetch(`${R2_BASE}/ice-servers`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) return stun
    const json = (await res.json()) as { iceServers?: IceServer[] }
    return json.iceServers?.length ? json.iceServers : stun
  } catch {
    return stun
  }
}

function asCall(id: string, data: Record<string, unknown>, customerId?: string): VoiceCall {
  return {
    id,
    customerId,
    from: String(data.from ?? 'customer') === 'owner' ? 'owner' : 'customer',
    status: String(data.status ?? 'ended'),
    offerSdp: String(data.offerSdp ?? ''),
    answerSdp: String(data.answerSdp ?? ''),
    recording: data.recording === true,
    recordingUrl: data.recordingUrl == null || data.recordingUrl === '' ? null : String(data.recordingUrl),
    durationMs: Number(data.durationMs ?? 0),
    startedAtMs: Number(data.startedAtMs ?? 0),
    answeredAtMs: data.answeredAtMs == null ? undefined : Number(data.answeredAtMs),
    endedAtMs: data.endedAtMs == null ? undefined : Number(data.endedAtMs),
    endedBy: data.endedBy == null ? undefined : String(data.endedBy),
    videoActive: data.videoActive === true,
    offerFrom: String(data.offerFrom ?? 'customer') === 'owner' ? 'owner' : 'customer',
    negotiationGen: Number(data.negotiationGen ?? 1),
    ownerVideoVisible: data.ownerVideoVisible === true,
  }
}

export function observeCalls(customerId: string, onData: (rows: VoiceCall[]) => void): Unsubscribe {
  const database = requireDb()
  const q = query(collection(database, COL.customers, customerId, COL.calls), orderBy('startedAtMs', 'desc'))
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => asCall(d.id, d.data() as Record<string, unknown>, customerId)))
  })
}

export function observeCall(customerId: string, callId: string, onData: (row: VoiceCall | null) => void): Unsubscribe {
  const database = requireDb()
  return onSnapshot(doc(database, COL.customers, customerId, COL.calls, callId), (snap) => {
    onData(snap.exists() ? asCall(snap.id, snap.data() as Record<string, unknown>, customerId) : null)
  })
}

export type IceCandidateDoc = {
  id: string
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
}

export function observeIce(
  customerId: string,
  callId: string,
  side: 'iceOffer' | 'iceAnswer',
  onAdded: (row: IceCandidateDoc) => void,
): Unsubscribe {
  const database = requireDb()
  const colName = side === 'iceOffer' ? COL.iceOffer : COL.iceAnswer
  return onSnapshot(collection(database, COL.customers, customerId, COL.calls, callId, colName), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== 'added') return
      const data = change.doc.data() as Record<string, unknown>
      onAdded({
        id: change.doc.id,
        candidate: String(data.candidate ?? ''),
        sdpMid: data.sdpMid == null ? null : String(data.sdpMid),
        sdpMLineIndex: data.sdpMLineIndex == null ? null : Number(data.sdpMLineIndex),
      })
    })
  })
}

export async function addIceCandidate(
  customerId: string,
  callId: string,
  side: 'iceOffer' | 'iceAnswer',
  ice: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null },
): Promise<void> {
  const colName = side === 'iceOffer' ? COL.iceOffer : COL.iceAnswer
  await addDoc(collection(requireDb(), COL.customers, customerId, COL.calls, callId, colName), {
    candidate: ice.candidate,
    createdAtMs: Date.now(),
    ...(ice.sdpMid != null && ice.sdpMid !== '' ? { sdpMid: ice.sdpMid } : {}),
    ...(ice.sdpMLineIndex != null && Number.isFinite(ice.sdpMLineIndex) ? { sdpMLineIndex: ice.sdpMLineIndex } : {}),
  })
}

export async function answerCall(customerId: string, callId: string, answerSdp: string): Promise<void> {
  const database = requireDb()
  await updateDoc(doc(database, COL.customers, customerId, COL.calls, callId), {
    status: 'in_call',
    answerSdp,
    answeredAtMs: Date.now(),
    negotiationGen: 1,
  })
  await updateDoc(doc(database, COL.customers, customerId), { chatAgentLive: true })
}

export async function pushCallOffer(
  customerId: string,
  callId: string,
  offerSdp: string,
  negotiationGen: number,
  offerFrom: 'customer' | 'owner',
  videoActive: boolean,
  ownerVideoVisible: boolean,
): Promise<void> {
  await updateDoc(doc(requireDb(), COL.customers, customerId, COL.calls, callId), {
    offerSdp,
    negotiationGen,
    offerFrom,
    videoActive,
    ownerVideoVisible,
  })
}

export async function pushCallAnswer(customerId: string, callId: string, answerSdp: string, negotiationGen: number): Promise<void> {
  await updateDoc(doc(requireDb(), COL.customers, customerId, COL.calls, callId), {
    answerSdp,
    negotiationGen,
  })
}

export async function hangupCall(
  customerId: string,
  callId: string,
  by: 'owner' | 'customer',
  status: 'ended' | 'missed' = 'ended',
): Promise<void> {
  await updateDoc(doc(requireDb(), COL.customers, customerId, COL.calls, callId), {
    status,
    endedAtMs: Date.now(),
    endedBy: by,
    recording: false,
  })
}

export async function setCallRecording(customerId: string, callId: string, recording: boolean): Promise<void> {
  await updateDoc(doc(requireDb(), COL.customers, customerId, COL.calls, callId), { recording })
}

export async function saveCallRecording(
  customerId: string,
  callId: string,
  blob: Blob,
  durationMs: number,
): Promise<string> {
  const token = await auth?.currentUser?.getIdToken(true)
  if (!token) throw new Error('Sign in required to save a recording.')
  const key = `orgs/${ORG_ID}/customers/${customerId}/calls/${callId}/recording.webm`
  const contentType = blob.type || 'audio/webm'
  const sign = await fetch(`${R2_BASE}/sign-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ key, contentType }),
  })
  if (!sign.ok) throw new Error(`Could not prepare the recording upload (${sign.status}).`)
  const payload = (await sign.json()) as { putUrl?: string }
  if (!payload.putUrl) throw new Error('Upload URL missing.')
  const put = await fetch(payload.putUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType, authorization: `Bearer ${token}` },
    body: blob,
  })
  if (!put.ok) throw new Error(`Could not upload the recording (${put.status}).`)
  const recordingUrl = `${R2_BASE}/object?key=${encodeURIComponent(key)}`
  await updateDoc(doc(requireDb(), COL.customers, customerId, COL.calls, callId), {
    recordingUrl,
    durationMs,
    recording: false,
  })
  return recordingUrl
}

export async function getCall(customerId: string, callId: string): Promise<VoiceCall | null> {
  const snap = await getDoc(doc(requireDb(), COL.customers, customerId, COL.calls, callId))
  return snap.exists() ? asCall(snap.id, snap.data() as Record<string, unknown>, customerId) : null
}
