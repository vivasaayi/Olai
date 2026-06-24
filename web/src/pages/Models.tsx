import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { ModelInfo } from '../types'

export default function ModelsPage() {
  const [available, setAvailable] = useState<ModelInfo[]>([])
  const [local, setLocal] = useState<string[]>([])
  const [downloading, setDownloading] = useState<string | null>(null)

  async function refresh() {
    try {
      const av = (await invoke('list_available_models')) as ModelInfo[]
      setAvailable(av)
      const lm = (await invoke('list_local_models')) as string[]
      setLocal(lm)
    } catch (err) {
      console.error('refresh models', err)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function onDownload(id: string) {
    setDownloading(id)
    try {
      await invoke('download_model', { modelId: id })
      await refresh()
    } catch (err) {
      console.error('download failed', err)
    }
    setDownloading(null)
  }

  const isDownloaded = (id: string) => local.find((f) => f.startsWith(id))

  return (
    <div className="panel card">
      <header className="card-header">
        <h2>Agents (Models)</h2>
        <p>Download mobile-first models to your device for offline inference.</p>
      </header>
      <div className="form-grid">
        {available.map((m) => (
          <div key={m.id} className="model-row">
            <div>
              <strong>{m.name}</strong>
              <div className="muted">{m.description}</div>
            </div>
            <div>
              <span className="muted">{m.size_mb ? `${m.size_mb} MB` : ''}</span>
              {isDownloaded(m.id) ? (
                <button className="button" disabled>
                  Downloaded
                </button>
              ) : (
                <button
                  className="button"
                  onClick={() => onDownload(m.id)}
                  disabled={downloading !== null}
                >
                  {downloading === m.id ? 'Downloading...' : 'Download'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
