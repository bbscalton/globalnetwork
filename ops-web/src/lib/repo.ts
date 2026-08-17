import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { COL, db, functions } from './firebase'
import { ORG_ID } from './admin'
import type { ChatMessage, Customer, CustomerStatus, DeskInvite, DeskMember, DeskRole, IssueTicket, Payment, Plan } from './types'

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
          kind: data.kind === 'partial' || data.kind === 'grace' ? data.kind : 'full',
          daysGranted: Number(data.daysGranted ?? 0),
          note: String(data.note ?? ''),
          atMs: Number(data.atMs ?? 0),
          byUid: String(data.byUid ?? ''),
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
  const fn = httpsCallable<Req, Res>(functions, name)
  const res = await fn(data)
  return res.data
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
