import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ChatMessage, Customer } from './lib/types'
import * as repo from './lib/repo'
import { fmtWhen, initials } from './lib/desk'

export function ChatDesk({ customers }: { customers: Customer[] }) {
  const [params, setParams] = useSearchParams()
  const ranked = useMemo(
    () => [...customers].sort((a, b) => (b.unreadStaff ?? 0) - (a.unreadStaff ?? 0)),
    [customers],
  )
  const [selected, setSelected] = useState(params.get('c') || ranked[0]?.id || '')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const fromUrl = params.get('c')
    if (fromUrl) setSelected(fromUrl)
  }, [params])

  useEffect(() => {
    if (!selected && ranked[0]) setSelected(ranked[0].id)
  }, [ranked, selected])

  useEffect(() => {
    if (!selected) return
    return repo.observeChat(selected, setMessages)
  }, [selected])

  const pick = (id: string) => {
    setSelected(id)
    setParams({ c: id })
  }

  const current = customers.find((c) => c.id === selected)

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected || !draft.trim()) return
    const text = draft.trim()
    setDraft('')
    await repo.sendChat(selected, text, 'staff')
  }

  return (
    <div className="inbox">
      <header className="desk-hero compact">
        <div>
          <p className="eyebrow">Support</p>
          <h1>Inbox</h1>
        </div>
      </header>
      <div className="inbox-layout">
        <aside className="inbox-list">
          {ranked.map((c) => (
            <button key={c.id} type="button" className={`inbox-item ${selected === c.id ? 'is-on' : ''}`} onClick={() => pick(c.id)}>
              <span className="avatar">{initials(c.name)}</span>
              <span>
                <strong>{c.name}</strong>
                <div className="muted tiny">{c.planName || 'No plan'}</div>
              </span>
              {(c.unreadStaff ?? 0) > 0 && <span className="badge">{c.unreadStaff}</span>}
            </button>
          ))}
          {ranked.length === 0 && <p className="muted">No customers yet.</p>}
        </aside>
        <section className="card chat-card inbox-thread">
          <div className="card-head">
            <h2>{current?.name || 'Select a customer'}</h2>
            {current && <Link to={`/c/${current.id}`}>Open record</Link>}
          </div>
          <div className="thread">
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.from}`}>
                <span className="muted tiny">{m.from === 'staff' ? 'Desk' : 'Customer'} · {fmtWhen(m.createdAtMs)}</span>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
          <form className="composer" onSubmit={(e) => void send(e)}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply…" disabled={!selected} />
            <button className="btn btn-primary" type="submit" disabled={!selected}>
              Send
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
