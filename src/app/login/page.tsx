'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(false)

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      setError(true)
      setPassword('')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-xs">
        <h1 className="text-cream text-xl font-bold tracking-[0.25em] uppercase text-center mb-8">
          The Crate
        </h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className={error ? 'border-accent' : ''}
          />
          {error && (
            <p className="text-accent text-xs">Wrong password.</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? '…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
