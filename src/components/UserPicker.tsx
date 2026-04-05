'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function UserPicker({ onSelect }: { onSelect: (name: string) => void }) {
  const [users, setUsers] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    // Get unique usernames from all tables
    const [s, c, w] = await Promise.all([
      supabase.from('spins').select('username'),
      supabase.from('collection').select('username'),
      supabase.from('wishlist').select('username'),
    ])
    const all = [
      ...(s.data || []),
      ...(c.data || []),
      ...(w.data || []),
    ]
    const unique = [...new Set(all.map(r => r.username))].sort()
    setUsers(unique)
    setLoading(false)
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    onSelect(name)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <h1 className="text-cream text-lg font-bold tracking-[0.25em] uppercase text-center mb-1">The Crate</h1>
        <p className="text-cream-dim text-xs tracking-wide text-center mb-8">Who&apos;s digging?</p>

        {loading ? (
          <p className="text-cream-dim text-sm text-center">Loading…</p>
        ) : (
          <div className="space-y-3">
            {users.map(name => (
              <button
                key={name}
                onClick={() => onSelect(name)}
                className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-cream text-sm font-medium hover:border-teal hover:text-teal transition-colors text-left"
              >
                {name}
              </button>
            ))}

            <div className="pt-4 border-t border-border">
              <p className="text-cream-dim text-xs uppercase tracking-wider mb-2">New user</p>
              <form onSubmit={handleCreate} className="flex gap-2">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Enter your name"
                  className="flex-1"
                  autoFocus={users.length === 0}
                />
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
                >
                  Go
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
