import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ChatMessage, Customer, IssueTicket, VoiceCall } from './lib/types'
import * as repo from './lib/repo'
import { ChatBubbleBody, kindOf } from './ChatMedia'
import { fmtWhen, initials, statusTone } from './lib/desk'
import { customerPin, displayAddress } from './lib/geo'

const ISSUE_LABEL: Record<IssueTicket['status'], string> = {
  open: 'Still open',
  in_progress: 'Ongoing',
  resolved: 'Resolved',
}

function previewOf(c: Customer): string {
  if (c.lastChatKind === 'voice') return 'Voice note'
  if (c.lastChatKind === 'video') return 'Video clip'
  if (c.lastChatKind === 'location') return 'Shared location'
  if (c.lastChatKind === 'call') return 'Voice call'
  if (c.callStatus === 'ringing') return 'Incoming voice call'
  if (c.callStatus === 'in_call') return 'Live voice call'
  if (c.lastChatPreview) return c.lastChatPreview
  if ((c.unreadStaff ?? 0) > 0) return 'New message'
  return c.planName || 'No plan'
}

export function ChatDesk({ customers, issues }: { customers: Customer[]; issues: IssueTicket[] }) {
  const [params, setParams] = useSearchParams()
  const ranked = useMemo(
    () =>
      [...customers].sort((a, b) => {
        const unread = (b.unreadStaff ?? 0) - (a.unreadStaff ?? 0)
        if (unread) return unread
        return (b.lastChatAtMs ?? 0) - (a.lastChatAtMs ?? 0)
      }),
    [customers],
  )
  const [selected, setSelected] = useState(params.get('c') || ranked[0]?.id || '')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [calls, setCalls] = useState<VoiceCall[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fromUrl = params.get('c')
    if (fromUrl) setSelected(fromUrl)
  }, [params])

  useEffect(() => {
    if (!selected && ranked[0]) setSelected(ranked[0].id)
  }, [ranked, selected])

  useEffect(() => {
    if (!selected) return
    const unsubs = [repo.observeChat(selected, setMessages), repo.observeCalls(selected, setCalls)]
    void repo.markChatRead(selected).catch(() => undefined)
    return () => unsubs.forEach((unsub) => unsub())
  }, [selected])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, selected])

  const pick = (id: string) => {
    setSelected(id)
    setParams({ c: id })
  }

  const current = customers.find((c) => c.id === selected)
  const theirs = issues.filter((i) => i.customerId === selected)
  const openIssue = theirs.find((i) => i.status !== 'resolved')
  const recordings = [
    ...messages
      .filter((m) => {
        const kind = kindOf(m)
        return (kind === 'voice' || kind === 'video' || kind === 'call') && Boolean(m.mediaUrl)
      })
      .map((m) => ({ id: m.id, atMs: m.createdAtMs, kind: kindOf(m), message: m })),
    ...calls
      .filter((c) => c.recordingUrl && !messages.some((m) => m.mediaUrl === c.recordingUrl))
      .map((c) => ({
        id: `call-${c.id}`,
        atMs: c.endedAtMs || c.startedAtMs,
        kind: 'call' as const,
        message: {
          id: c.id,
          from: 'owner' as const,
          text: 'Call recording',
          kind: 'call',
          mediaUrl: c.recordingUrl,
          durationMs: c.durationMs,
          createdAtMs: c.endedAtMs || c.startedAtMs,
        } satisfies ChatMessage,
      })),
  ].sort((a, b) => b.atMs - a.atMs)
  const agentLive = Boolean(current?.chatAgentLive)

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected || !draft.trim() || busy) return
    const text = draft.trim()
    setDraft('')
    setBusy(true)
    try {
      await repo.sendChat(selected, text, 'owner')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inbox">
      <header className="desk-hero compact">
        <div>
          <p className="eyebrow">Live desk</p>
          <h1>Inbox</h1>
          <p className="muted">Play voice notes and clips, take in-app calls, drive the line issue, take over from the bot.</p>
        </div>
        {current && (
          <span className={`pill ${agentLive ? 'ok' : 'warn'}`}>{agentLive ? 'Live agent' : 'Bot covering'}</span>
        )}
      </header>
      <div className="inbox-layout inbox-pro">
        <aside className="inbox-list">
          {ranked.map((c) => {
            const ticket = issues.find((i) => i.customerId === c.id && i.status !== 'resolved')
            return (
              <button key={c.id} type="button" className={`inbox-item ${selected === c.id ? 'is-on' : ''}`} onClick={() => pick(c.id)}>
                <span className="avatar">{initials(c.name)}</span>
                <span>
                  <strong>{c.name}</strong>
                  <div className="muted tiny clip">{previewOf(c)}</div>
                </span>
                <span className="inbox-meta">
                  {(c.unreadStaff ?? 0) > 0 && <span className="badge">{c.unreadStaff}</span>}
                  {ticket && <span className={`pill ${ticket.status === 'open' ? 'fail' : 'warn'}`}>{ISSUE_LABEL[ticket.status]}</span>}
                  {(c.callStatus === 'ringing' || c.callStatus === 'in_call') && (
                    <span className={`pill ${c.callStatus === 'ringing' ? 'fail gn-pulse' : 'ok'}`}>
                      {c.callStatus === 'ringing' ? 'Calling' : 'On call'}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
          {ranked.length === 0 && <p className="muted">No customers yet.</p>}
        </aside>
        <section className="card chat-card inbox-thread">
          <div className="card-head chat-head">
            <div>
              <h2>{current?.name || 'Select a customer'}</h2>
              {current && (
                <p className="muted tiny">
                  <span className={`pill ${statusTone(current.status)}`}>{current.status}</span>
                  {' · '}
                  {current.planName || 'No plan'}
                  {current.phone ? ` · ${current.phone}` : ''}
                  {customerPin(current) ? ` · ${displayAddress(current)}` : ''}
                </p>
              )}
            </div>
            {current && (
              <div className="chat-head-actions">
                <Link to={`/c/${current.id}`}>Open record</Link>
                {customerPin(current) && <Link to={`/field?c=${current.id}`}>Field map</Link>}
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      setBusy(true)
                      try {
                        await repo.setChatAgentLive(current.id, !agentLive)
                      } finally {
                        setBusy(false)
                      }
                    })()
                  }
                >
                  {agentLive ? 'Return to bot' : 'Take over'}
                </button>
              </div>
            )}
          </div>
          {!agentLive && current && (
            <p className="bot-banner">Desk bot is answering until you take over. Recordings still land here.</p>
          )}
          <div className="thread" ref={threadRef}>
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.from}`}>
                <span className="muted tiny">
                  {m.from === 'owner' ? 'You' : m.from === 'bot' ? 'Desk bot' : 'Customer'} · {fmtWhen(m.createdAtMs)}
                </span>
                <ChatBubbleBody m={m} customerId={selected} />
              </div>
            ))}
            {messages.length === 0 && <p className="empty">No messages yet in this thread.</p>}
          </div>
          <form className="composer" onSubmit={(e) => void send(e)}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={agentLive ? 'Reply as the live agent…' : 'Take over, then reply — or the bot will keep covering'}
              disabled={!selected || busy}
            />
            <button className="btn btn-primary" type="submit" disabled={!selected || busy || !draft.trim()}>
              Send
            </button>
          </form>
        </section>
        <aside className="chat-side">
          <section className="card">
            <div className="card-head">
              <h2>Line issue</h2>
            </div>
            {theirs.length === 0 && (
              <div>
                <p className="muted">Nothing logged yet. Open a ticket so the field can see it.</p>
                {current && (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        setBusy(true)
                        try {
                          await repo.createIssue(current.id, 'Reported in chat', 'Opened from the owner inbox.')
                        } finally {
                          setBusy(false)
                        }
                      })()
                    }
                  >
                    Open issue
                  </button>
                )}
              </div>
            )}
            {theirs.map((issue) => (
              <article key={issue.id} className="side-issue">
                <strong>{issue.title}</strong>
                <p className="muted tiny">{issue.body || 'No extra detail.'}</p>
                <div className="chips">
                  {(['open', 'in_progress', 'resolved'] as const).map((status) => (
                    <button
                      key={status}
                      className={`chip ${issue.status === status ? 'is-on' : ''}`}
                      type="button"
                      onClick={() => void repo.setIssueStatus(issue.customerId, issue.id, status)}
                    >
                      {ISSUE_LABEL[status]}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {openIssue && <p className="muted tiny">Mark Ongoing while you are working it. Resolve only when the line is actually back.</p>}
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Recordings</h2>
              <span className="muted tiny">{recordings.length}</span>
            </div>
            {recordings.length === 0 && <p className="muted">Voice notes, clips, and desk call recordings for this customer show up here.</p>}
            <div className="recording-list">
              {recordings.map((item) => (
                <div key={item.id} className="recording-card">
                  <span className="muted tiny">
                    {item.kind === 'video' ? 'Video' : item.kind === 'call' ? 'Call' : 'Voice'} · {fmtWhen(item.atMs)}
                  </span>
                  <ChatBubbleBody m={item.message} customerId={selected} />
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
