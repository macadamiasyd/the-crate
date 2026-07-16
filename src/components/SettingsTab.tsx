'use client'

import { useState } from 'react'
import type { SkippedRecord } from '@/app/api/discogs-enrich/route'

interface EnrichReport {
  total: number
  updated: number
  skipped: number
  errors: number
  skippedList: SkippedRecord[]
  remaining: number
}

interface ValuesReport {
  total: number
  updated: number
  errors: number
}

export default function SettingsTab({ username }: { username: string }) {
  const [enriching, setEnriching] = useState(false)
  const [enrichReport, setEnrichReport] = useState<EnrichReport | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<string | null>(null)

  const [refreshingValues, setRefreshingValues] = useState(false)
  const [valuesReport, setValuesReport] = useState<ValuesReport | null>(null)

  const [sendingDigest, setSendingDigest] = useState(false)
  const [digestResult, setDigestResult] = useState<string | null>(null)

  async function handleEnrich() {
    setEnriching(true)
    setApplyResult(null)
    try {
      const res = await fetch('/api/discogs-enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data: EnrichReport = await res.json()
      setEnrichReport(prev => prev ? {
        total: prev.total + data.total,
        updated: prev.updated + data.updated,
        skipped: prev.skipped + data.skipped,
        errors: prev.errors + data.errors,
        skippedList: [...prev.skippedList, ...data.skippedList],
        remaining: data.remaining,
      } : data)
    } catch {
      setEnrichReport(prev => prev
        ? { ...prev, errors: prev.errors + 1, remaining: 0 }
        : { total: 0, updated: 0, skipped: 0, errors: 1, skippedList: [], remaining: 0 }
      )
    }
    setEnriching(false)
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    const matchable = (enrichReport?.skippedList ?? []).filter(r => r.pending)
    setSelected(new Set(matchable.map(r => r.id)))
  }

  async function handleApply() {
    if (!enrichReport || selected.size === 0) return
    setApplying(true)
    setApplyResult(null)
    const items = enrichReport.skippedList
      .filter(r => r.pending && selected.has(r.id))
      .map(r => ({ id: r.id, pending: r.pending! }))
    try {
      const res = await fetch('/api/discogs-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, items }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { applied, errors } = await res.json()
      setApplyResult(`Applied ${applied} record${applied !== 1 ? 's' : ''}${errors ? ` (${errors} errors)` : ''}`)
      // Remove applied items from the skipped list
      const appliedIds = new Set(items.map(i => i.id))
      setEnrichReport(prev => prev ? {
        ...prev,
        updated: prev.updated + applied,
        skipped: prev.skipped - applied,
        skippedList: prev.skippedList.filter(r => !appliedIds.has(r.id)),
      } : prev)
      setSelected(new Set())
    } catch {
      setApplyResult('Apply failed — try again')
    }
    setApplying(false)
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

  const matchable = (enrichReport?.skippedList ?? []).filter(r => r.pending)
  const noResults = (enrichReport?.skippedList ?? []).filter(r => !r.pending)

  return (
    <div className="space-y-8 max-w-xl">

      {/* Discogs enrichment */}
      <section>
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Discogs Enrichment</h2>
        <div className="bg-surface rounded-lg p-4 sm:p-5 space-y-4">
          <p className="text-cream-dim text-sm">
            Searches Discogs for collection records missing cover art, label, and catalogue number.
            Matched records get enriched; ambiguous results are listed below for you to review.
          </p>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="px-4 py-2 bg-surface2 text-cream border border-border rounded text-sm hover:border-teal hover:text-teal transition-colors disabled:opacity-50"
          >
            {enriching
              ? 'Enriching… (this takes a while)'
              : enrichReport && enrichReport.remaining > 0
                ? `Continue enriching (${enrichReport.remaining} remaining)`
                : 'Enrich from Discogs'}
          </button>

          {enrichReport && (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="text-sm text-cream">
                {enrichReport.updated} updated · {enrichReport.skipped} skipped · {enrichReport.errors} errors (of {enrichReport.total} processed)
                {enrichReport.remaining > 0 && <span className="text-cream-dim"> · {enrichReport.remaining} still queued</span>}
              </div>

              {/* Records with a Discogs suggestion to review */}
              {matchable.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-cream-dim text-xs">Suggested matches — tick to accept ({selected.size} selected)</span>
                    <button onClick={selectAll} className="text-xs text-teal hover:underline">Select all</button>
                  </div>
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {matchable.map(r => (
                      <li key={r.id} className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          className="mt-0.5 accent-teal shrink-0"
                        />
                        <span className="text-cream-dim">
                          <span className="text-cream">{r.text}</span>
                          {r.discogsLabel && <> → <span className="text-cream-dim">{r.discogsLabel}</span></>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleApply}
                      disabled={applying || selected.size === 0}
                      className="px-3 py-1.5 bg-teal text-bg text-xs font-medium rounded hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      {applying ? 'Applying…' : `Apply ${selected.size > 0 ? selected.size : ''} selected`}
                    </button>
                    {applyResult && <span className="text-xs text-cream-dim">{applyResult}</span>}
                  </div>
                </div>
              )}

              {/* No-results records */}
              {noResults.length > 0 && (
                <details className="mt-1">
                  <summary className="text-cream-dim cursor-pointer text-xs">No Discogs match ({noResults.length})</summary>
                  <ul className="mt-2 space-y-1 text-xs text-cream-dim">
                    {noResults.map(r => <li key={r.id}>{r.text}</li>)}
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
