import { useEffect, useState, type FormEvent } from 'react'
import type { ChatMessage, Customer } from './types'
import { observeChat, sendChat } from './repo'

export function ChatPanel({ customers }: { customers: Customer[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(customers[0]?.id ?? null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!selectedId && customers[0]) setSelectedId(customers[0].id)
  }, [customers, selectedId])

  useEffect(() => {
    if (!selectedId) return
    return observeChat(selectedId, setMessages)
  }, [selectedId])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedId || !draft.trim()) return
    const text = draft.trim()
    setDraft('')
    await sendChat(selectedId, text, 'staff')
  }

  const selected = customers.find((c) => c.id === selectedId)

  return (
    <div className="tcd-card tcd-card-wide">
      <div className="tcd-card-head">
        <h2>Support chat</h2>
        <span className="tcd-card-timestamp">Realtime Firestore</span>
      </div>
      <div className="tcd-chat-layout">
        <div className="tcd-chat-list">
          {customers.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tcd-arch-flow-tab ${selectedId === c.id ? 'is-active' : ''}`}
              onClick={() => setSelectedId(c.id)}
            >
              {c.name}
              {(c.unreadStaff ?? 0) > 0 ? ` (${c.unreadStaff})` : ''}
            </button>
          ))}
          {customers.length === 0 && <p className="muted small">Create a customer to start chatting.</p>}
        </div>
        <div className="tcd-chat-thread">
          <div className="tcd-chat-msgs">
            <p className="muted small">{selected ? `Thread with ${selected.name}` : 'Select a customer'}</p>
            {messages.map((m) => (
              <div key={m.id} className={`tcd-chat-bubble ${m.from}`}>
                <strong>{m.from}</strong>
                <div>{m.text}</div>
                {m.mediaUrl && (
                  <a href={m.mediaUrl} target="_blank" rel="noreferrer">
                    attachment
                  </a>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={(e) => void send(e)} style={{ display: 'flex', gap: '0.6rem' }}>
            <input
              style={{ flex: 1, padding: '0.75rem', borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)', color: '#fff' }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the customer…"
            />
            <button className="btn btn-primary" type="submit" disabled={!selectedId}>
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
