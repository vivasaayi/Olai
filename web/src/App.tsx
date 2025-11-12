import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <h1>BookForge</h1>
        <p>AI-Guided Education App</p>
      </div>
    </>
  )
}

export default App