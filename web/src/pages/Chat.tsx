import { useEffect, useState } from 'react'
import { request } from '../api'

export default function ChatPage() {
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([])

  async function refreshModels() {
    const result = await request<{ data: { id: string }[] }>('/api/llm-router/v1/models')
    const local = result.data.map(({ id }) => id)
    setModels(local)
    if (local.length && !selected) {
      setSelected(local[0])
    }
  }

  useEffect(() => {
    refreshModels()
  }, [])

  async function send() {
    if (!selected || !prompt) return
    const modelName = selected
    setMessages((m) => [...m, { role: 'user', text: prompt }])
    try {
      const result = await request<{ choices: { message: { content: string } }[] }>('/api/llm-router/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelName, messages: [{ role: 'user', content: prompt }] }) })
      const reply = result.choices[0].message.content
      setMessages((m) => [...m, { role: 'assistant', text: reply }])
      setPrompt('')
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${String(err)}` }])
    }
  }

  return (
    <div className="panel card">
      <header className="card-header">
        <h2>Model Chat</h2>
        <p>Choose an available model and start a conversation.</p>
      </header>
      <div className="form-grid">
        <label>
          <span>Select model</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">(Select model)</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <div>
          <textarea
            className="full-width"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            placeholder="Type your prompt..."
          />
        </div>
        <div className="header-actions">
          <button className="button" onClick={send} type="button">
            Send
          </button>
          <button className="button" onClick={() => refreshModels()} type="button">
            Refresh
          </button>
        </div>

        <div className="chat-history">
          {messages.map((m, idx) => (
            <div key={idx} className={`chat-message ${m.role}`}>
              <strong>{m.role}</strong>
              <pre>{m.text}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
