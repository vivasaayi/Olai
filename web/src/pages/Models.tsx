import { useEffect, useState } from 'react'
import { request } from '../api'

export default function ModelsPage() {
  const [models, setModels] = useState<{ id: string }[]>([])
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const result = await request<{ data: { id: string }[] }>('/api/llm-router/v1/models')
      setModels(result.data)
      setError('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => { void refresh() }, [])

  return (
    <div className="panel card">
      <header className="card-header">
        <h2>Available models</h2>
        <button className="button secondary" type="button" onClick={() => void refresh()}>Refresh</button>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      {models.map((model) => <p key={model.id}>{model.id}</p>)}
    </div>
  )
}
