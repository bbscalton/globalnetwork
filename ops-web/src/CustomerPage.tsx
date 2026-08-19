import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { ChatMessage, Customer, IssueTicket, Payment, Plan } from './lib/types'
import * as repo from './lib/repo'
import { ChatBubbleBody } from './ChatMedia'
import { cyclePct, fmtDate, fmtWhen, initials, statusTone } from './lib/desk'
import { useAuth } from './lib/authContext'
import { AuthImage } from './lib/AuthImage'
import { customerPin, displayAddress, looksLikeCoordinates } from './lib/geo'

export function CustomerPage({
  customers,
  plans,
  issues,
  now,
}: {
  customers: Customer[]
  plans: Plan[]
  issues: IssueTicket[]
  now: number
}) {
  const { id } = useParams()
  const navigate = useNavigate()
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
    setAmount(customer.balanceDue > 0 ? String(customer.balanceDue) : String(customer.feeAmount || ''))
    setRemainDays(String(Math.max(0, repo.daysLeft(customer.paidUntilMs, Date.now()))))
  }, [customer?.id, customer?.planDays, customer?.feeAmount, customer?.balanceDue, customer?.paidUntilMs])

  const relatedIssues = useMemo(() => issues.filter((i) => i.customerId === id), [issues, id])

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

  const left = repo.daysLeft(customer.paidUntilMs, now)
  const pct = cyclePct(customer, now)

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

  const extend = (useDays: number, paid: number, text: string) =>
    run(async () => {
      const res = await repo.extendSubscription({
        customerId: customer.id,
        days: useDays,
        amountPaid: paid,
        note: text,
        locationId: 'owner-desk',
        locationName: 'Owner desk',
      })
      setNote('')
      return `Service through ${fmtDate(res.paidUntilMs)} · ${res.status} · balance ${repo.formatEc(res.balanceDue)}`
    })

  const extendN = Math.floor(Number(extendDays))
  const extendCharge =
    Number.isFinite(extendN) && extendN >= 1 ? extendN * repo.DAY_EXTENSION_RATE_XCD : null

  const grantExtension = () =>
    run(async () => {
      if (!Number.isFinite(extendN) || extendN < 1) throw new Error('Enter how many days to extend.')
      const res = await repo.grantDayExtension({
        customerId: customer.id,
        days: extendN,
        note: note || undefined,
      })
      setNote('')
      return `Extended ${res.daysGranted}d · ${res.status} · ${repo.formatEc(res.balanceAdded)} added to balance · now ${repo.formatEc(res.balanceDue)} owed · through ${fmtDate(res.paidUntilMs)}`
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

  const assignPlan = async (planId: string) => {
    const plan = plans.find((p) => p.id === planId)
    if (!plan) return
    await repo.updateCustomerContact(customer.id, {
      planId: plan.id,
      planName: plan.name,
      planDays: plan.days,
      feeAmount: plan.feeAmount,
    })
    setMsg(`Assigned ${plan.name}. Grant days to put them on-network.`)
  }

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
          <p className="days-left">{left > 0 ? `${left} days left` : 'Off network'}</p>
          <p className="muted tiny">Paid until {fmtDate(customer.paidUntilMs)}</p>
        </div>
      </header>

      <div className="cycle-hero">
        <div className="cycle-hero-top">
          <span>Current cycle</span>
          <span>
            {pct}% remaining · balance {repo.formatEc(customer.balanceDue)}
          </span>
        </div>
        <div className="cycle-track lg glow-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      {err && <p className="fail">{err}</p>}
      {msg && <p className="ok-text">{msg}</p>}

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
        <div className="quick-renew">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => void extend(customer.planDays || 30, customer.feeAmount, 'Full plan renewal')}
          >
            Collect full {customer.planDays || 30}d · {repo.formatEc(customer.feeAmount)}
          </button>
          {customer.status === 'suspended' ? (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const res = await repo.unsuspendCustomer(customer.id)
                  return `Unsuspended · ${res.status}`
                })
              }
            >
              Unsuspend
            </button>
          ) : (
            <button className="btn btn-ghost danger" type="button" disabled={busy} onClick={() => void run(async () => {
              await repo.suspendCustomer(customer.id)
              return 'Service suspended'
            })}>
              Suspend
            </button>
          )}
        </div>
        <div className="form-row" style={{ marginTop: '1rem' }}>
          <label>
            Days to extend
            <input value={extendDays} onChange={(e) => setExtendDays(e.target.value)} placeholder="e.g. 3" />
          </label>
          <button className="btn btn-ghost" type="button" disabled={busy || extendCharge == null} onClick={() => void grantExtension()}>
            Extend
          </button>
        </div>
        <p className="muted tiny">
          {extendCharge != null
            ? `EC$${repo.DAY_EXTENSION_RATE_XCD} × ${extendN} days = ${repo.formatEc(extendCharge)} added to balance`
            : `EC$${repo.DAY_EXTENSION_RATE_XCD} per day added to what they owe when they next pay.`}
        </p>
        <div className="form-row" style={{ marginTop: '1rem' }}>
          <label>
            Days to grant
            <input value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label>
            Amount paid (EC$)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Waiting on rest of fee" />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => void extend(Number(days), Number(amount || 0), note)}
          >
            Apply
          </button>
        </div>
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
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const res = await repo.adjustSubscription({
                  customerId: customer.id,
                  daysRemaining: Number(remainDays),
                  note: adjustNote,
                })
                setAdjustNote('')
                return `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`
              })
            }
          >
            Apply
          </button>
        </div>
        <div className="quick-renew" style={{ marginTop: '0.75rem' }}>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const res = await repo.adjustSubscription({ customerId: customer.id, addDays: 1, note: adjustNote || '+1 day' })
                return `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`
              })
            }
          >
            +1 day
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const res = await repo.adjustSubscription({ customerId: customer.id, addDays: 7, note: adjustNote || '+7 days' })
                return `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`
              })
            }
          >
            +7 days
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const res = await repo.adjustSubscription({ customerId: customer.id, addDays: -1, note: adjustNote || '−1 day' })
                return `Now ${res.daysRemaining} day${res.daysRemaining === 1 ? '' : 's'} left · ${res.status}`
              })
            }
          >
            −1 day
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
            <select value={customer.planId} onChange={(e) => void assignPlan(e.target.value)}>
              <option value="">Unassigned</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.days}d · {repo.formatEc(p.feeAmount)} {p.active ? '' : '(hidden)'}
                </option>
              ))}
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
          <div className="form-row" style={{ marginTop: '0.75rem' }}>
            <button
              className="btn danger"
              type="button"
              disabled={busy || !(customer.omadaClientMac || customer.cpeMac)}
              onClick={() => {
                if (!window.confirm(`Disconnect CPE at this location? This kicks/blocks the house radio on the Omada AP. The ER7206 WAN stays up.`)) return
                void run(async () => {
                  const res = await repo.omadaEr7206SetClientBlocked({ customerId: customer.id, blocked: true })
                  return `CPE disconnected (${res.mac}).`
                })
              }}
            >
              Disconnect CPE
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || !(customer.omadaClientMac || customer.cpeMac)}
              onClick={() => {
                if (!window.confirm('Reconnect CPE at this location? Unblock the wireless station and try Omada reconnect.')) return
                void run(async () => {
                  const res = await repo.omadaEr7206SetClientBlocked({ customerId: customer.id, blocked: false })
                  return `CPE reconnected (${res.mac}${res.reconnectOk ? ', reconnect sent' : ''}).`
                })
              }}
            >
              Reconnect CPE
            </button>
          </div>
          <p className="muted tiny">These buttons kick the house CPE off the AP. Account Suspend above only marks billing — it does not touch the ER7206 WAN.</p>
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
                    {p.kind === 'extension' ? `${repo.formatEc(p.balanceAdded || 0)} owed` : repo.formatEc(p.amount)}
                  </strong>{' '}
                  · {p.kind} · {p.daysGranted}d
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
