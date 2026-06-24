import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Book } from '../types'

export default function ChatPage() {
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([])

  async function refreshModels() {
    const local = (await invoke('list_local_models')) as string[]
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
    // The rust backend accepts filename or id. If the filename contains .bin we pass it through.
    const modelName = selected
    setMessages((m) => [...m, { role: 'user', text: prompt }])
    try {
      const reply = (await invoke('chat_with_model', { modelName, prompt })) as string
      setMessages((m) => [...m, { role: 'assistant', text: reply }])
      setPrompt('')
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${String(err)}` }])
    }
  }

  return (
    <div className="panel card">
      <header className="card-header">
        <h2>Chat (Local Model)</h2>
        <p>Send prompts to a locally downloaded mobile model</p>
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
