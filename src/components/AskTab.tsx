'use client'

import { useState } from 'react'

const EXAMPLES = [
  'What genre do I listen to most?',
  'What are my top 5 most-played albums?',
  'When did I last listen to Miles Davis?',
  'What albums from the 1970s are in my collection?',
  'How many spins did I log this month?',
  'Which artists am I missing from my collection?',
]

export default function AskTab() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim()) return
    setLoading(true)
    setAnswer('')
    setError('')

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      })
      const data = await res.json()
      if (data.error) setError(data.error)
      else setAnswer(data.answer)
    } catch {
      setError('Request failed. Check your network and API key.')
    }

    setLoading(false)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-1">Ask About Your Collection</h2>
        <p className="text-cream-dim text-sm leading-relaxed">
          Ask anything about your listening history or record collection. Claude has full context of your spins and collection.
        </p>
      </div>

      {/* Example questions */}
      <div>
        <p className="text-cream-dim text-xs uppercase tracking-wider mb-2">Try asking</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => setQuestion(ex)}
              className="px-3 py-1.5 text-xs text-cream-dim bg-surface border border-border rounded hover:text-cream hover:border-cream-dim transition-colors text-left"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Question form */}
      <form onSubmit={handleAsk} className="space-y-3">
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask anything about your listening history…"
          rows={3}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleAsk(e)
            }
          }}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="p-4 bg-surface border border-accent/40 rounded text-accent text-sm">
          {error}
        </div>
      )}

      {/* Answer */}
      {answer && (
        <div className="p-5 bg-surface border border-border rounded-lg">
          <p className="text-cream-dim text-xs uppercase tracking-wider mb-3">Answer</p>
          <div className="text-cream text-sm leading-relaxed whitespace-pre-wrap">{answer}</div>
        </div>
      )}
    </div>
  )
}
