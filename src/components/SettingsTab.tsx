'use client'

import { useState } from 'react'

interface EnrichReport {
  total: number
  updated: number
  skipped: number
  errors: number
  skippedList: string[]
}

interface ValuesReport {
  total: number
  updated: number
  errors: number
}

export default function SettingsTab({ username }: { username: string }) {
  const [enriching, setEnriching] = useState(false)
  const [enrichReport, setEnrichReport] = useState<EnrichReport | null>(null)
  const [refreshingValues, setRefreshingValues] = useState(false)
  const [valuesReport, setValuesReport] = useState<ValuesReport | null>(null)
  const [sendingDigest, setSendingDigest] = useState(false)
  const [digestResult, setDigestResult] = useState<string | null>(null)

  async function handleEnrich() {
    setEnriching(true)
    setEnrichReport(null)
    try {
      const res = await fetch('/api/discogs-enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      const data = await res.json()
      setEnrichReport(data)
    } catch {
      setEnrichReport({ total: 0, updated: 0, skipped: 0, errors: 1, skippedList: ['Request failed'] })
    }
    setEnriching(false)
  }

  async function handleRefreshValues() {
    setRefreshingValues(true)
    setValuesReport(null)
    try {
      const res = await fetch('/api/discogs-values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      const data = await res.json()
      setValuesReport(data)
    } catch {
      setValuesReport({ total: 0, updated: 0, errors: 1 })
    }
    setRefreshingValues(false)
  }

  async function handleTestDigest() {
    setSendingDigest(true)
    setDigestResult(null)
    try {
      const secret = prompt('Enter CRON_SECRET:')
      if (!secret) { setSendingDigest(false); return }
      const res = await fetch('/api/digest', {
        headers: { 'Authorization': `Bearer ${secret}` },
      })
      setDigestResult(res.ok ? '✓ Digest sent — check your inbox' : `Error ${res.status}`)
    } catch {
      setDigestResult('Request failed')
    }
    setSendingDigest(false)
  }

  return (
    <div className="space-y-8 max-w-xl">

      {/* Discogs enrichment */}
      <section>
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Discogs Enrichment</h2>
        <div className="bg-surface rounded-lg p-4 sm:p-5 space-y-4">
          <p className="text-cream-dim text-sm">
            Searches Discogs for collection records missing cover art, label, and catalogue number.
            Matched records get enriched; ambiguous results are skipped and listed below.
          </p>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="px-4 py-2 bg-surface2 text-cream border border-border rounded text-sm hover:border-teal hover:text-teal transition-colors disabled:opacity-50"
          >
            {enriching ? 'Enriching… (this takes a while)' : 'Enrich from Discogs'}
          </button>

          {enrichReport && (
            <div className="text-sm space-y-1 border-t border-border pt-3">
              <div className="text-cream">{enrichReport.updated} updated · {enrichReport.skipped} skipped · {enrichReport.errors} errors (of {enrichReport.total} without Discogs data)</div>
              {enrichReport.skippedList.length > 0 && (
                <details className="mt-2">
                  <summary className="text-cream-dim cursor-pointer text-xs">Skipped records ({enrichReport.skippedList.length})</summary>
                  <ul className="mt-2 space-y-1 text-xs text-cream-dim">
                    {enrichReport.skippedList.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="border-t border-border pt-4">
            <p className="text-cream-dim text-xs mb-3">
              Refresh pricing data (lowest ask) for records already matched to Discogs. ~300+ API calls — takes several minutes.
            </p>
            <button
              onClick={handleRefreshValues}
              disabled={refreshingValues}
              className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:border-teal hover:text-teal transition-colors disabled:opacity-50"
            >
              {refreshingValues ? 'Refreshing values…' : 'Refresh Values'}
            </button>
            {valuesReport && (
              <div className="mt-2 text-sm text-cream-dim">
                {valuesReport.updated} updated · {valuesReport.errors} errors (of {valuesReport.total})
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Weekly digest */}
      <section>
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Weekly Digest</h2>
        <div className="bg-surface rounded-lg p-4 sm:p-5 space-y-4">
          <p className="text-cream-dim text-sm">
            Sends the weekly digest email immediately. Normally runs automatically at 9am Sunday (Sydney).
          </p>
          <button
            onClick={handleTestDigest}
            disabled={sendingDigest}
            className="px-4 py-2 bg-surface2 text-cream border border-border rounded text-sm hover:border-teal hover:text-teal transition-colors disabled:opacity-50"
          >
            {sendingDigest ? 'Sending…' : 'Send test digest'}
          </button>
          {digestResult && <div className="text-sm text-cream-dim">{digestResult}</div>}
        </div>
      </section>

    </div>
  )
}
