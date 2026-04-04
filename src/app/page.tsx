'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import LogTab from '@/components/LogTab'
import CollectionTab from '@/components/CollectionTab'
import WishlistTab from '@/components/WishlistTab'
import AskTab from '@/components/AskTab'
import StatsTab from '@/components/StatsTab'

type Tab = 'log' | 'collection' | 'wishlist' | 'ask' | 'stats'

const TABS: { id: Tab; label: string }[] = [
  { id: 'log', label: 'Log' },
  { id: 'collection', label: 'Collection' },
  { id: 'wishlist', label: 'Wishlist' },
  { id: 'ask', label: 'Ask' },
  { id: 'stats', label: 'Stats' },
]

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('log')
  const [exportLoading, setExportLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)

  async function handleExport() {
    setExportLoading(true)
    try {
      const [spinsRes, collectionRes] = await Promise.all([
        supabase.from('spins').select('*').order('date_played', { ascending: false }),
        supabase.from('collection').select('*').order('artist'),
      ])
      const data = {
        exported_at: new Date().toISOString(),
        spins: spinsRes.data || [],
        collection: collectionRes.data || [],
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `the-crate-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed', e)
    }
    setExportLoading(false)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportLoading(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      const spinsData = data.spins ?? data.records
      if (Array.isArray(spinsData)) {
        for (const spin of spinsData) {
          const { created_at: _c, ...rest } = spin
          await supabase.from('spins').upsert(rest, { onConflict: 'id' })
        }
      }
      if (Array.isArray(data.collection)) {
        for (const record of data.collection) {
          const { created_at: _c, ...rest } = record
          await supabase.from('collection').upsert(rest, { onConflict: 'id' })
        }
      }
      alert('Import complete! Refresh to see updated data.')
    } catch {
      alert('Import failed. Make sure the file is a valid The Crate backup.')
    }
    setImportLoading(false)
    e.target.value = ''
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-cream text-base sm:text-lg font-bold tracking-[0.25em] uppercase">The Crate</h1>
          <p className="text-cream-dim text-xs tracking-wide hidden sm:block">Vinyl Listening Log</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExport}
            disabled={exportLoading}
            className="px-2.5 sm:px-3 py-1.5 text-xs text-cream-dim border border-border rounded hover:text-cream hover:border-cream-dim transition-colors disabled:opacity-40"
          >
            {exportLoading ? '…' : 'Export'}
          </button>
          <label className="px-2.5 sm:px-3 py-1.5 text-xs text-cream-dim border border-border rounded hover:text-cream hover:border-cream-dim transition-colors cursor-pointer">
            {importLoading ? '…' : 'Import'}
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="border-b border-border px-2 sm:px-6 flex overflow-x-auto scrollbar-hide">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 sm:px-5 py-3 text-xs sm:text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-cream border-accent'
                : 'text-cream-dim border-transparent hover:text-cream'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8">
        {activeTab === 'log' && <LogTab />}
        {activeTab === 'collection' && <CollectionTab />}
        {activeTab === 'wishlist' && <WishlistTab />}
        {activeTab === 'ask' && <AskTab />}
        {activeTab === 'stats' && <StatsTab />}
      </main>
    </div>
  )
}
