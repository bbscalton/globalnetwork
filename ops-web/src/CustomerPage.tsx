import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { ChatMessage, Customer, ExtensionRequest, IssueTicket, Payment, Plan } from './lib/types'
import * as repo from './lib/repo'
import { ChatBubbleBody } from './ChatMedia'
import { cyclePct, fmtDate, fmtWhen, initials, remainingLabel, statusTone } from './lib/desk'
import { useAuth } from './lib/authContext'
import { AuthImage } from './lib/AuthImage'
import { customerPin, displayAddress, looksLikeCoordinates } from './lib/geo'
import { DataUsagePanel } from './DataUsagePanel'
import { runRouterCommand, useRouterLocks } from './lib/routerLock'

export function CustomerPage({
  customers,
  plans,
  issues,
  now,
  pendingExtensions = [],
}: {
  customers: Customer[]
  plans: Plan[]
  issues: IssueTicket[]
  now: number
  pendingExtensions?: ExtensionRequest[]
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const routerLocks = useRouterLocks()
  const { isOwner } = useAuth()
  const customer = customers.find((c) => c.id === id)
  const [payments, setPayments] = useState<Payment[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [days, setDays] = useState('')
  const [extendDays, setExtendDays] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [routerUser, setRouterUser] = useState('')
  const [routerPass, setRouterPass] = useState('')
  const [routerMac, setRouterMac] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [remainDays, setRemainDays] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [editMsgId, setEditMsgId] = useState<string | null>(null)
  const [editMsgText, setEditMsgText] = useState('')
  const [editIssueId, setEditIssueId] = useState<string | null>(null)
  const [editIssueTitle, setEditIssueTitle] = useState('')
  const [editIssueBody, setEditIssueBody] = useState('')

  useEffect(() => {
    if (!id) return
    const u1 = repo.observePayments(id, setPayments)
    const u2 = repo.observeChat(id, setMessages)
    return () => {
      u1()
      u2()
    }
  }, [id])

  useEffect(() => {
    if (!customer) return
    setDays(String(customer.planDays || 30))
    const collectTarget =
      customer.feeAmount > 0
        ? customer.feeAmount + (customer.extensionDue > 0 ? customer.extensionDue : 0)
        : customer.balanceDue > 0
          ? customer.balanceDue
          : ''
    setAmount(collectTarget === '' ? '' : String(collectTarget))
    setRemainDays(String(Math.max(0, repo.daysLeft(customer.paidUntilMs, Date.now()))))
  }, [
    customer?.id,
    customer?.planDays,
    customer?.feeAmount,
    customer?.balanceDue,
    customer?.extensionDue,
    customer?.paidUntilMs,
  ])

  const relatedIssues = useMemo(() => issues.filter((i) => i.customerId === id), [issues, id])
  const catalogPlans = useMemo(() => {
    return [...plans].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      if (a.days !== b.days) return a.days - b.days
      return a.name.localeCompare(b.name)
    })
  }, [plans])
  const sellingPlans = useMemo(() => catalogPlans.filter((p) => p.active), [catalogPlans])

  if (!id) return <Navigate to="/" replace />
  if (customers.length > 0 && !customer) {
    return (
      <div className="desk">
        <p className="fail">This customer is not on the desk.</p>
        <Link to="/">Back to roster</Link>
      </div>
    )
  }
  if (!customer) return <p className="muted">Loading record…</p>

  const pct = cyclePct(customer, now)
  const needsPackage =
    !String(customer.planId || '').trim() ||
    !String(customer.planName || '').trim() ||
    !(Number(customer.feeAmount) > 0)
  const currentPlan = catalogPlans.find((p) => p.id === customer.planId)
  const packageLabel = customer.planName || currentPlan?.name || 'Unassigned'

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      setMsg(await work())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  // Every button that makes the ER7206 change (block/unblock, suspend, payments/days that unblock,
  // create user) shares one per-customer lock: locks immediately, unlocks when the queued
  // er7206Queue job is done AND 30s passed (2-min fallback). Unlinked customers skip the lock.
  const routerKey = `customer-router:${customer.id}`
  const routerLinked = !!customer.er7206UserName
  const routerLocked = routerLinked && routerLocks.locked(routerKey)
  const routerAction = routerLocks.optimistic<string>(routerKey)
  const routerBtn = (action: string, idle: string) =>
    routerLocked && routerAction === action ? routerLocks.lockText(routerKey, idle) : idle
  const runRouter = (action: string, work: () => Promise<{ msg: string; jobId?: string | null }>, force = false) => {
    if (!routerLinked && !force) return run(async () => (await work()).msg)
    if (routerLocked) return Promise.resolve()
    return run(async () => {
      let out = ''
      await runRouterCommand(
        routerKey,
        async () => {
          const r = await work()
          out = r.msg
          return r.jobId ?? null
        },
        { optimistic: action },
      )
      return out
    })
  }

  const extend = (useDays: number, paid: number, text: string, action = 'extend') =>
    runRouter(action, async () => {
      const res = await repo.extendSubscription({
        customerId: customer.id,
        days: useDays,
        amountPaid: paid,
        note: text,
        locationId: 'owner-desk',
        locationName: 'Owner desk',
      })
      setNote('')
      const extNote =
        (res.extensionCollected || 0) > 0
          ? ` · also cleared ${repo.formatEc(res.extensionCollected || 0)} extension`
          : res.extensionDue > 0
            ? ` · extension still ${repo.formatEc(res.extensionDue)}`
            : ''
      return { msg: `Plan collected · through ${fmtDate(res.paidUntilMs)} · total due ${repo.formatEc(res.balanceDue)}${extNote}`, jobId: (res as { routerJobId?: string | null }).routerJobId }
    })

  const extendN = Math.floor(Number(extendDays))
  const extendCharge =
    Number.isFinite(extendN) && extendN >= 1 ? extendN * repo.DAY_EXTENSION_RATE_XCD : null

  const grantExtension = (paidNow: boolean) =>
    runRouter(paidNow ? 'grant-paid' : 'grant', async () => {
      if (!Number.isFinite(extendN) || extendN < 1) throw new Error('Enter how many days to extend.')
      const res = await repo.grantDayExtension({
        customerId: customer.id,
        days: extendN,
        note: note || undefined,
        paidNow,
        locationId: 'owner-desk',
        locationName: 'Owner desk',
      })
      setNote('')
      if (paidNow) {
        return { msg: `Extended ${res.daysGranted}d · collected ${repo.formatEc(res.amountCollected || extendCharge || 0)} · plan due still ${repo.formatEc(res.planDue)} · through ${fmtDate(res.paidUntilMs)}` }
      }
      return { msg: `Extended ${res.daysGranted}d · ${repo.formatEc(res.balanceAdded)} charged to extension · plan due ${repo.formatEc(res.planDue)} · total ${repo.formatEc(res.balanceDue)} · through ${fmtDate(res.paidUntilMs)}` }
    })

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    const text = draft.trim()
    setDraft('')
    await run(async () => {
      await repo.sendChat(customer.id, text, 'owner')
      return ''
    })
  }

  const assignPlan = (planId: string) =>
    void run(async () => {
      const nextId = planId.trim()
      if (!nextId) {
        await repo.updateCustomerContact(customer.id, {
          planId: '',
          planName: '',
          planDays: 0,
          feeAmount: 0,
        })
        return 'Package cleared — Unassigned. Assign a plan before Collect full.'
      }
      const plan = catalogPlans.find((p) => p.id === nextId)
      if (!plan) throw new Error('That plan is not in the catalog. Add it under Plans, then refresh.')
      await repo.updateCustomerContact(customer.id, {
        planId: plan.id,
        planName: plan.name,
        planDays: plan.days,
        feeAmount: plan.feeAmount,
      })
      return `Assigned ${plan.name} · ${plan.days}d · ${repo.formatEc(plan.feeAmount)}. Collect full now uses this fee.`
    })

  const planOptionLabel = (p: Plan) =>
    `${p.name} · ${p.days}d · ${repo.formatEc(p.feeAmount)}${p.active ? '' : ' (hidden)'}`

  const planSelectOptions = (
    <>
      <option value="">{needsPackage ? 'Select a package…' : 'Unassigned'}</option>
      {sellingPlans.map((p) => (
        <option key={p.id} value={p.id}>
          {planOptionLabel(p)}
        </option>
      ))}
      {catalogPlans
        .filter((p) => !p.active)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {planOptionLabel(p)}
          </option>
        ))}
      {customer.planId && !catalogPlans.some((p) => p.id === customer.planId) && (
        <option value={customer.planId}>
          {customer.planName || customer.planId} · {customer.planDays || '?'}d · {repo.formatEc(customer.feeAmount)} (missing from catalog)
        </option>
      )}
    </>
  )

  return (
    <div className="record">
      <button className="back" type="button" onClick={() => navigate('/')}>
        ← Roster
      </button>
      <header className="record-hero">
        <span className="avatar xl">{initials(customer.name)}</span>
        <div className="record-id">
          <p className="eyebrow">{customer.planName || 'No package'}</p>
          <h1>{customer.name}</h1>
          <p className="muted">
            {customer.phone || 'No phone'} · {customer.email || 'No email'}
            <br />
            {displayAddress(customer)}
            {customerPin(customer) && (
              <>
                {' · '}
                <Link to={`/field?c=${customer.id}`}>Field map</Link>
              </>
            )}
          </p>
        </div>
        <div className="record-status">
          <span className={`pill ${statusTone(customer.status)}`}>{customer.status}</span>
          <p className="days-left">{remainingLabel(customer.paidUntilMs, now)}</p>
          <p className="muted tiny">Paid until {fmtDate(customer.paidUntilMs)} (Antigua)</p>
        </div>
      </header>

      <div className="cycle-hero">
        <div className="cycle-hero-top">
          <span>Current cycle</span>
          <span>{pct}% remaining</span>
        </div>
        <div className="cycle-track lg glow-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <ul className="dues-row" style={{ marginTop: '0.75rem' }}>
          <li>
            <span>Plan due</span>
            <strong>{repo.formatEc(customer.planDue)}</strong>
          </li>
          <li>
            <span>Extensions</span>
            <strong>{repo.formatEc(customer.extensionDue)}</strong>
          </li>
          <li>
            <span>Total</span>
            <strong>{repo.formatEc(customer.balanceDue)}</strong>
          </li>
          {customer.balanceOwed > 0 && (
            <li className="balance-owed">
              <span>Balance owed</span>
              <strong className="warn-text">{repo.formatEc(customer.balanceOwed)}</strong>
            </li>
          )}
        </ul>
        {customer.balanceOwed > 0 && (
          <p className="warn-text tiny" style={{ marginTop: '0.5rem' }}>
            Outstanding balance: Customer owes {repo.formatEc(customer.balanceOwed)} from partial payments.
          </p>
        )}
      </div>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

      {pendingExtensions.filter((r) => r.customerId === customer.id).map((r) => (
        <section key={r.id} className="card action-card">
          <div className="card-head">
            <h2>Extension request</h2>
            <span className="pill warn">Pending</span>
          </div>
          <p>
            Requested <strong>{r.days} day{r.days === 1 ? '' : 's'}</strong> ({repo.formatEc(r.totalXcd)}) on {fmtWhen(r.requestedAtMs)}.
          </p>
          <div className="row-actions">
            {([
              ['Approve · paid now', 'approved', true],
              ['Approve · add to balance', 'approved', false],
              ['Decline', 'rejected', false],
            ] as const).map(([label, decision, paidNow]) => (
              <button
                key={label}
                className={decision === 'rejected' ? 'btn btn-ghost' : 'btn btn-primary'}
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setErr(null)
                  setMsg(null)
                  try {
                    await repo.processExtensionRequest({ requestId: r.id, decision, paidNow })
                    setMsg(decision === 'approved' ? `Extension of ${r.days} days approved.` : 'Extension request declined.')
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : 'Could not process request')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className={`card action-card${needsPackage ? ' package-needed' : ''}`}>
        <div className="card-head">
          <h2>{needsPackage ? 'Assign package' : 'Package'}</h2>
          <span className={`pill ${needsPackage ? 'warn' : 'ok'}`}>{packageLabel}</span>
        </div>
        {needsPackage ? (
          <p className="warn-text">
            No selling plan on this record — Collect full shows leftover days with EC$0 until you assign one from the
            catalog.
          </p>
        ) : (
          <p className="muted">
            Current: <strong>{packageLabel}</strong> · {customer.planDays || currentPlan?.days || '—'}d ·{' '}
            {repo.formatEc(customer.feeAmount)}. Change below anytime.
          </p>
        )}
        {catalogPlans.length === 0 ? (
          <p className="fail">
            Add a plan under Plans first — <Link to="/plans">open Plans</Link>.
          </p>
        ) : (
          <label style={{ marginTop: '0.75rem' }}>
            {needsPackage ? 'Pick a selling plan' : 'Change plan'}
            <select value={customer.planId || ''} disabled={busy} onChange={(e) => assignPlan(e.target.value)}>
              {planSelectOptions}
            </select>
          </label>
        )}
        {sellingPlans.length === 0 && catalogPlans.length > 0 && (
          <p className="muted tiny" style={{ marginTop: '0.5rem' }}>
            All catalog plans are hidden. Unhide one under <Link to="/plans">Plans</Link>, or pick a hidden plan above.
          </p>
        )}
      </section>

      {(customer.approvalStatus === 'pending' || customer.approvalStatus === 'rejected' || customer.idPhotoUrl) && (
        <section className="card action-card">
          <div className="card-head">
            <h2>Service application</h2>
            {customer.approvalStatus === 'pending' && <span className="pill warn">Awaiting approval</span>}
            {customer.approvalStatus === 'approved' && <span className="pill ok">Approved</span>}
            {customer.approvalStatus === 'rejected' && <span className="pill fail">Rejected</span>}
          </div>
          <p className="muted">
            They submitted name, address, phone, an ID photo, and a billing-address photo. Approve first, then assign
            payment and days below from what they paid or your own assessment.
          </p>
          {customer.rejectionReason && <p className="fail">{customer.rejectionReason}</p>}
          <div className="kyc-grid">
            {customer.idPhotoUrl && (
              <figure>
                <figcaption>ID</figcaption>
                <AuthImage url={customer.idPhotoUrl} alt="Customer ID" />
              </figure>
            )}
            {customer.billingPhotoUrl && (
              <figure>
                <figcaption>Billing address</figcaption>
                <AuthImage url={customer.billingPhotoUrl} alt="Billing address proof" />
              </figure>
            )}
          </div>
          {customer.approvalStatus === 'pending' && (
            <div className="form-row" style={{ marginTop: '1rem' }}>
              <label>
                If you reject, say why
                <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Photo is unclear…" />
              </label>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repo.reviewCustomerApplication(customer.id, 'approved')
                    return 'Application approved. Assign a plan and grant days from the payment you received.'
                  })
                }
              >
                Approve
              </button>
              <button
                className="btn btn-ghost danger"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repo.reviewCustomerApplication(customer.id, 'rejected', rejectReason.trim())
                    setRejectReason('')
                    return 'Application sent back to the customer to fix.'
                  })
                }
              >
                Reject
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card action-card">
        <div className="card-head">
          <h2>Renew or collect</h2>
        </div>
        {needsPackage && (
          <p className="warn-text" style={{ marginBottom: '0.75rem' }}>
            Assign a package above before Collect full — fee is still EC$0.
          </p>
        )}
        <p className="muted tiny" style={{ marginBottom: '0.75rem' }}>
          Plan collect = full package fee only (no partial plan payments). Paying the plan clears plan due; if you collect
          fee + extension in one amount, extension due clears too. Extension cash alone never clears plan due.
        </p>
        <div className="quick-renew">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || needsPackage || routerLocked}
            title={needsPackage ? 'Assign a package first' : undefined}
            onClick={() =>
              void extend(
                customer.planDays || 30,
                customer.feeAmount + (customer.extensionDue > 0 ? customer.extensionDue : 0),
                customer.extensionDue > 0 ? 'Full plan + extension due' : 'Full plan renewal',
                'collect-full',
              )
            }
          >
            {routerBtn('collect-full', `Collect full ${customer.planDays || 30}d · ${repo.formatEc(customer.feeAmount)}${customer.extensionDue > 0 ? ` + ext ${repo.formatEc(customer.extensionDue)}` : ''}`)}
          </button>
          {customer.extensionDue > 0 && !needsPackage && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy || routerLocked}
              onClick={() => void extend(customer.planDays || 30, customer.feeAmount, 'Full plan renewal', 'plan-only')}
            >
              {routerBtn('plan-only', `Plan only · ${repo.formatEc(customer.feeAmount)}`)}
            </button>
          )}
          {(routerAction === 'suspend' ? true : routerAction === 'unsuspend' ? false : customer.status === 'suspended') ? (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy || routerLocked}
              onClick={() =>
                void runRouter('unsuspend', async () => {
                  const res = await repo.unsuspendCustomer(customer.id)
                  return { msg: `Unsuspended · ${res.status}`, jobId: (res as { routerJobId?: string | null }).routerJobId }
                })
              }
            >
              {routerBtn('suspend', 'Unsuspend')}
            </button>
          ) : (
            <button className="btn btn-ghost danger" type="button" disabled={busy || routerLocked} onClick={() => void runRouter('suspend', async () => {
              const res = (await repo.suspendCustomer(customer.id)) as unknown as { routerJobId?: string | null } | undefined
              return { msg: 'Service suspended', jobId: res?.routerJobId }
            })}>
              {routerBtn('unsuspend', 'Suspend')}
            </button>
          )}
        </div>
        <div className="router-link" style={{ marginTop: '0.75rem' }}>
          {customer.er7206UserName ? (
            <div className="muted tiny">
              ER7206 router user: <strong>{customer.er7206UserName}</strong> · Suspend blocks it, Unsuspend / payments unblock it (VPS worker, ~30s).
            <span className="form-row">
              <button className="btn btn-ghost danger" type="button" disabled={busy || routerLocked} onClick={() => void runRouter('block', async () => {
                const res = await repo.er7206LocalSetUserEnable({ customerId: customer.id, enable: false })
                if (!res.ok) throw new Error(res.error || 'Router block failed')
                return { msg: `Router block queued (${res.routerJobId})`, jobId: res.routerJobId }
              })}>{routerBtn('block', 'Block on router')}</button>
              <button className="btn btn-ghost" type="button" disabled={busy || routerLocked} onClick={() => void runRouter('unblock', async () => {
                const res = await repo.er7206LocalSetUserEnable({ customerId: customer.id, enable: true })
                if (!res.ok) throw new Error(res.error || 'Router unblock failed')
                return { msg: `Router unblock queued (${res.routerJobId})`, jobId: res.routerJobId }
              })}>{routerBtn('unblock', 'Unblock on router')}</button>
            </span>
            {routerLocked && (routerAction === 'block' || routerAction === 'unblock') && (
              <div className="tiny"><span className="pill warn">{routerAction === 'block' ? 'Blocking on router…' : 'Unblocking on router…'}</span></div>
            )}
            {routerLocks.note(routerKey) && <div className="tiny warn-text">{routerLocks.note(routerKey)}</div>}
            </div>
          ) : (
            <form
              className="form-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (routerLocks.locked(routerKey)) return
                void runRouter('create', async () => {
                  const res = await repo.er7206CreateRouterUser({
                    customerId: customer.id,
                    userName: routerUser.trim(),
                    password: routerPass,
                    mac: routerMac.trim() || customer.cpeMac || '',
                  })
                  setRouterPass('')
                  return { msg: `Router user queued (${res.routerJobId}). It appears on the ER7206 within ~30s.`, jobId: res.routerJobId }
                }, true)
              }}
            >
              <label>
                Router username
                <input value={routerUser} autoComplete="off" onChange={(e) => setRouterUser(e.target.value)} />
              </label>
              <label>
                Router password
                <input type="password" value={routerPass} autoComplete="new-password" onChange={(e) => setRouterPass(e.target.value)} />
              </label>
              <label>
                CPE MAC (optional)
                <input value={routerMac} placeholder={customer.cpeMac || 'AA-BB-CC-DD-EE-FF'} onChange={(e) => setRouterMac(e.target.value)} />
              </label>
              <button className="btn btn-ghost" type="submit" disabled={busy || routerLocks.locked(routerKey) || !routerUser.trim() || routerPass.length < 4}>
                {routerLocks.locked(routerKey) ? routerLocks.lockText(routerKey, 'Create on router') : 'Create on router'}
              </button>
            </form>
          )}
        </div>
        <div className="card" style={{ marginTop: '0.75rem', padding: '0.9rem' }}>
          <DataUsagePanel customer={customer} isOwner={isOwner} />
        </div>
        <div className="form-row" style={{ marginTop: '1rem' }}>
          <label>
            Days to extend
            <input value={extendDays} onChange={(e) => setExtendDays(e.target.value)} placeholder="e.g. 3" />
          </label>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || extendCharge == null || routerLocked}
            onClick={() => void grantExtension(false)}
          >
            {routerBtn('grant', 'Charge to balance')}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || extendCharge == null || routerLocked}
            onClick={() => void grantExtension(true)}
          >
            {routerBtn('grant-paid', 'Collect extension now')}
          </button>
        </div>
        <p className="muted tiny">
          {extendCharge != null
            ? `EC$${repo.DAY_EXTENSION_RATE_XCD} × ${extendN} = ${repo.formatEc(extendCharge)}. Charge stacks on extension due (plan due unchanged). Collect now takes cash and does not add to extension due.`
            : `EC$${repo.DAY_EXTENSION_RATE_XCD}/day. Charge to balance or collect extension now.`}
        </p>
        <div className="form-row" style={{ marginTop: '1rem' }}>
          <label>
            Days to grant
            <input value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label>
            Amount paid (EC$) — full plan fee min.
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Receipt note" />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || needsPackage || routerLocked}
            onClick={() => void extend(Number(days), Number(amount || 0), note, 'collect-plan')}
          >
            {routerBtn('collect-plan', 'Collect plan')}
          </button>
        </div>
      </section>

      <section className="card action-card">
        <div className="card-head">
          <h2>Partial payment</h2>
          {customer.balanceOwed > 0 && <span className="pill warn">Owes {repo.formatEc(customer.balanceOwed)}</span>}
        </div>
        <p className="muted tiny">
          Accept partial payment and optionally grant days. The customer keeps a running balance that shows in their app.
        </p>
        <PartialPaymentForm
          customer={customer}
          disabled={busy || routerLocked}
          onCollect={(amountPaid, grantDays, payNote) =>
            void runRouter('partial', async () => {
              const res = await repo.collectPayment({
                customerId: customer.id,
                amountPaid,
                grantDays: grantDays > 0 ? grantDays : undefined,
                note: payNote || undefined,
                locationId: 'owner-desk',
                locationName: 'Owner desk',
              })
              return { msg: `Collected ${repo.formatEc(res.amountPaid)}${res.daysGranted > 0 ? ` · granted ${res.daysGranted}d` : ''} · balance owed now ${repo.formatEc(res.balanceOwed)}`, jobId: (res as { routerJobId?: string | null }).routerJobId }
            })
          }
        />
      </section>

      <section className="card action-card">
        <div className="card-head">
          <h2>Adjust remaining time</h2>
        </div>
        <p className="muted">Set days left without collecting a payment. Writes an adjust entry on the ledger.</p>
        <div className="form-row">
          <label>
            Days remaining
            <input value={remainDays} onChange={(e) => setRemainDays(e.target.value)} />
          </label>
          <label>
            Note
            <input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="Courtesy days, correction…" />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || routerLocked}
            onClick={() =>
              void runRouter('adjust-apply', async () => {
                const res = await repo.adjustSubscription({
                  customerId: customer.id,
                  daysRemaining: Number(remainDays),
                  note: adjustNote,
                })
                setAdjustNote('')
                return { msg: `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`, jobId: (res as { routerJobId?: string | null }).routerJobId }
              })
            }
          >
            {routerBtn('adjust-apply', 'Apply')}
          </button>
        </div>
        <div className="quick-renew" style={{ marginTop: '0.75rem' }}>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || routerLocked}
            onClick={() =>
              void runRouter('add1', async () => {
                const res = await repo.adjustSubscription({ customerId: customer.id, addDays: 1, note: adjustNote || '+1 day' })
                return { msg: `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`, jobId: (res as { routerJobId?: string | null }).routerJobId }
              })
            }
          >
            {routerBtn('add1', '+1 day')}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || routerLocked}
            onClick={() =>
              void runRouter('add7', async () => {
                const res = await repo.adjustSubscription({ customerId: customer.id, addDays: 7, note: adjustNote || '+7 days' })
                return { msg: `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`, jobId: (res as { routerJobId?: string | null }).routerJobId }
              })
            }
          >
            {routerBtn('add7', '+7 days')}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || routerLocked}
            onClick={() =>
              void runRouter('sub1', async () => {
                const res = await repo.adjustSubscription({ customerId: customer.id, addDays: -1, note: adjustNote || '−1 day' })
                return { msg: `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`, jobId: (res as { routerJobId?: string | null }).routerJobId }
              })
            }
          >
            {routerBtn('sub1', '−1 day')}
          </button>
        </div>
      </section>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>Profile</h2>
          </div>
          <label>
            Name
            <input
              defaultValue={customer.name}
              key={`${customer.id}-name`}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name && name !== customer.name) void repo.updateCustomerContact(customer.id, { name })
              }}
            />
          </label>
          <label>
            Package
            <select value={customer.planId || ''} disabled={busy || catalogPlans.length === 0} onChange={(e) => assignPlan(e.target.value)}>
              {planSelectOptions}
            </select>
          </label>
          <label>
            Address / site
            <input
              defaultValue={looksLikeCoordinates(customer.address) ? displayAddress(customer) : customer.address}
              key={`${customer.id}-address`}
              onBlur={(e) => {
                const address = e.target.value.trim()
                if (address !== customer.address) void repo.updateCustomerContact(customer.id, { address })
              }}
            />
          </label>
          <label>
            Email / Google account
            <input
              type="email"
              defaultValue={customer.email}
              key={`${customer.id}-email`}
              onBlur={(e) => {
                const next = e.target.value.trim().toLowerCase()
                if (next !== customer.email) void repo.updateCustomerContact(customer.id, { email: next })
              }}
            />
          </label>
          <label>
            Phone
            <input
              defaultValue={customer.phone}
              key={`${customer.id}-phone`}
              onBlur={(e) => {
                const phone = e.target.value.trim()
                if (phone !== customer.phone) void repo.updateCustomerContact(customer.id, { phone })
              }}
            />
          </label>
          <label>
            House CPE MAC (wireless station on the AP)
            <input
              defaultValue={customer.omadaClientMac || ''}
              key={`${customer.id}-omada-mac`}
              placeholder="AA-BB-CC-DD-EE-FF"
              onBlur={(e) => {
                const mac = e.target.value.trim()
                if (mac !== (customer.omadaClientMac || '')) {
                  void run(async () => {
                    await repo.saveOmadaClientMap(customer.id, mac)
                    return mac ? `Mapped CPE ${mac}` : 'Cleared CPE MAC'
                  })
                }
              }}
            />
          </label>
          <p className="muted tiny">CPE MAC is used when creating the ER7206 router user. Router block/unblock is in the account section above.</p>
          {isOwner && (
          <button
            className="btn danger"
            type="button"
            disabled={busy}
            style={{ marginTop: '0.85rem' }}
            onClick={() => {
              if (!window.confirm(`Delete ${customer.name}'s account, chat, tickets, and payments? This cannot be undone.`)) return
              void run(async () => {
                await repo.deleteCustomer(customer.id)
                navigate('/')
                return 'Account deleted'
              })
            }}
          >
            Delete this account
          </button>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Payment ledger</h2>
          </div>
          {payments.length === 0 && <p className="muted">No payments yet. The first extend writes the ledger.</p>}
          <ul className="ledger">
            {payments.map((p) => (
              <li key={p.id}>
                <span>
                  <strong>
                    {p.kind === 'extension' && !(Number(p.amount) > 0)
                      ? `${repo.formatEc(p.balanceAdded || 0)} owed`
                      : repo.formatEc(p.amount)}
                  </strong>{' '}
                  · {repo.paymentKindLabel(p)} · {p.daysGranted}d
                  {p.note ? <span className="muted"> — {p.note}</span> : null}
                  {p.locationName ? <span className="muted"> · {p.locationName}</span> : null}
                </span>
                <span className="ledger-end">
                  <span className="muted tiny">{fmtWhen(p.atMs)}</span>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm('Delete this ledger entry? Service days are not reversed.')) return
                      void run(async () => {
                        await repo.deletePayment(customer.id, p.id)
                        return 'Ledger entry deleted'
                      })
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
            {payments.length === 0 && customer.paidAmount > 0 && (
              <li>
                <span>
                  Lifetime collected <strong>{repo.formatEc(customer.paidAmount)}</strong>
                </span>
              </li>
            )}
          </ul>
        </section>
      </div>

      <div className="split">
        <section className="card chat-card">
          <div className="card-head">
            <h2>Thread</h2>
            <div className="chat-head-actions">
              <Link to={`/chat?c=${customer.id}`}>Open inbox</Link>
              <button
                className="btn btn-ghost danger"
                type="button"
                disabled={busy || messages.length === 0}
                onClick={() => {
                  if (!window.confirm('Delete messages older than 30 days in this thread?')) return
                  void run(async () => {
                    const res = await repo.tidyDesk({
                      action: 'deleteOldChat',
                      customerId: customer.id,
                      olderThanDays: 30,
                    })
                    return `Deleted ${res.deleted} old message${res.deleted === 1 ? '' : 's'}`
                  })
                }}
              >
                Delete old
              </button>
              <button
                className="btn btn-ghost danger"
                type="button"
                disabled={busy || messages.length === 0}
                onClick={() => {
                  if (!window.confirm('Clear this entire chat thread?')) return
                  void run(async () => {
                    const res = await repo.clearCustomerChat(customer.id)
                    return `Cleared ${res.deleted} message${res.deleted === 1 ? '' : 's'}`
                  })
                }}
              >
                Clear thread
              </button>
            </div>
          </div>
          <div className="thread">
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.from}`}>
                <span className="muted tiny">
                  {m.from === 'owner' ? 'You' : m.from === 'bot' ? 'Desk bot' : 'Customer'} · {fmtWhen(m.createdAtMs)}
                  {m.editedAtMs ? ' · edited' : ''}
                </span>
                {editMsgId === m.id ? (
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void run(async () => {
                        await repo.updateChatMessage(customer.id, m.id, editMsgText)
                        setEditMsgId(null)
                        return 'Message updated'
                      })
                    }}
                  >
                    <input value={editMsgText} onChange={(e) => setEditMsgText(e.target.value)} />
                    <button className="btn btn-primary" type="submit" disabled={busy}>
                      Save
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => setEditMsgId(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <ChatBubbleBody m={m} customerId={customer.id} />
                    <div className="bubble-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditMsgId(m.id)
                          setEditMsgText(m.text)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm('Delete this message?')) return
                          void run(async () => {
                            await repo.deleteChatMessage(customer.id, m.id)
                            return 'Message deleted'
                          })
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {messages.length === 0 && <p className="muted">No messages yet.</p>}
          </div>
          <form className="composer" onSubmit={(e) => void send(e)}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message this customer…" />
            <button className="btn btn-primary" type="submit">
              Send
            </button>
          </form>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Tickets</h2>
          </div>
          {relatedIssues.length === 0 && <p className="muted">No line issues on this account.</p>}
          {relatedIssues.map((issue) => (
            <article key={issue.id} className="ticket">
              <span className={`pill ${issue.status === 'resolved' ? 'ok' : issue.status === 'open' ? 'fail' : 'warn'}`}>{issue.status === 'in_progress' ? 'Ongoing' : issue.status === 'open' ? 'Still open' : 'Resolved'}</span>
              {editIssueId === issue.id ? (
                <>
                  <label>
                    Title
                    <input value={editIssueTitle} onChange={(e) => setEditIssueTitle(e.target.value)} />
                  </label>
                  <label>
                    Details
                    <textarea rows={3} value={editIssueBody} onChange={(e) => setEditIssueBody(e.target.value)} />
                  </label>
                  <div className="quick-renew" style={{ marginTop: 8 }}>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await repo.updateIssue(customer.id, issue.id, { title: editIssueTitle, body: editIssueBody })
                          setEditIssueId(null)
                          return 'Ticket updated'
                        })
                      }
                    >
                      Save
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => setEditIssueId(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3>{issue.title}</h3>
                  <p className="muted tiny">{fmtWhen(issue.createdAtMs)}</p>
                  <p>{issue.body}</p>
                </>
              )}
              <div className="photos">
                {issue.photoUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <AuthImage url={url} alt="" className="issue-thumb" />
                  </a>
                ))}
              </div>
              <div className="chips" style={{ marginTop: 8 }}>
                {(['open', 'in_progress', 'resolved'] as const).map((status) => (
                  <button
                    key={status}
                    className={`chip ${issue.status === status ? 'is-on' : ''}`}
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await repo.setIssueStatus(customer.id, issue.id, status)
                        return `Marked ${status === 'in_progress' ? 'ongoing' : status}`
                      })
                    }
                  >
                    {status === 'in_progress' ? 'Ongoing' : status === 'open' ? 'Still open' : 'Resolved'}
                  </button>
                ))}
              </div>
              {editIssueId !== issue.id && (
                <div className="bubble-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditIssueId(issue.id)
                      setEditIssueTitle(issue.title)
                      setEditIssueBody(issue.body)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm('Delete this ticket?')) return
                      void run(async () => {
                        await repo.deleteIssue(customer.id, issue.id)
                        return 'Ticket deleted'
                      })
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}

function PartialPaymentForm({
  customer,
  disabled,
  onCollect,
}: {
  customer: Customer
  disabled: boolean
  onCollect: (amountPaid: number, grantDays: number, note: string) => void
}) {
  const [partialAmount, setPartialAmount] = useState('')
  const [partialDays, setPartialDays] = useState('0')
  const [partialNote, setPartialNote] = useState('')

  const amountDue = customer.balanceOwed > 0 ? customer.balanceOwed : customer.balanceDue
  const parsedAmount = Number(partialAmount) || 0
  const parsedDays = Number(partialDays) || 0
  const remaining = Math.max(0, amountDue - parsedAmount)

  return (
    <div className="form-row" style={{ marginTop: '0.75rem' }}>
      <label>
        Amount received (EC$)
        <input
          value={partialAmount}
          onChange={(e) => setPartialAmount(e.target.value)}
          placeholder={`Up to ${repo.formatEc(amountDue)}`}
        />
      </label>
      <label>
        Days to grant
        <input value={partialDays} onChange={(e) => setPartialDays(e.target.value)} placeholder="0 = no days" />
      </label>
      <label>
        Note
        <input value={partialNote} onChange={(e) => setPartialNote(e.target.value)} placeholder="Partial payment…" />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={disabled || parsedAmount <= 0}
          onClick={() => {
            onCollect(parsedAmount, parsedDays, partialNote)
            setPartialAmount('')
            setPartialDays('0')
            setPartialNote('')
          }}
        >
          Collect partial
        </button>
        <span className="muted tiny">
          {parsedAmount > 0
            ? `Due: ${repo.formatEc(amountDue)} · Paid: ${repo.formatEc(parsedAmount)} · Remaining: ${repo.formatEc(remaining)}`
            : `Total due: ${repo.formatEc(amountDue)}`}
        </span>
      </div>
    </div>
  )
}
