import type { CacheTtl } from '../types'

export const CELLS = 20
export const FALLBACK_THRESHOLD = 83
export const LOG_LIMIT = 1800

export const ttlMs = (ttl: CacheTtl | null) => (ttl === '1h' ? 3_600_000 : 300_000)

export type CacheView = {
  minutes: number
  filled: number
  color: 'success' | 'warning' | 'error'
  isExpired: boolean
}

export const cacheView = (lastAt: number, now: number, ttl: CacheTtl | null): CacheView => {
  const total = ttlMs(ttl)
  const left = Math.max(0, total - Math.max(0, now - lastAt))
  const share = left / total

  return {
    minutes: Math.ceil(left / 60_000),
    filled: Math.ceil(share * CELLS),
    color: share > 0.25 ? 'success' : share > 0.1 ? 'warning' : 'error',
    isExpired: left === 0,
  }
}

export const weather = (percent: number | null, thresholdPercent: number) => {
  const share = thresholdPercent > 0 ? (percent ?? 0) / thresholdPercent : 0

  return share <= 0.5 ? '☀️' : share <= 0.8 ? '🌧️' : '⛈️'
}

export const STORM = '⛈️'

/** The TTL of the last cache write a transcript's tail records, or null. */
export const ttlOf = (jsonl: string): CacheTtl | null => {
  const lines = jsonl.split('\n')

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (line.includes('"isSidechain":true')) {
      continue
    }
    const hour = Number(/"ephemeral_1h_input_tokens":(\d+)/.exec(line)?.[1] ?? 0)
    const five = Number(/"ephemeral_5m_input_tokens":(\d+)/.exec(line)?.[1] ?? 0)

    if (hour > 0 || five > 0) {
      return hour >= five ? '1h' : '5m'
    }
  }

  return null
}

const cut = (text: string, limit: number): string[] => {
  const parts: string[] = []
  let rest = text

  while (rest.length > limit) {
    const head = rest.slice(0, limit)
    const at = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. ') + 1, head.lastIndexOf(' '))
    const end = at > limit / 2 ? at : limit
    parts.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end).trimStart()
  }

  return rest.length > 0 ? [...parts, rest] : parts
}

/** Splits at paragraphs into pieces no log line cuts off. */
export const chunks = (text: string, limit = LOG_LIMIT): string[] => {
  const out: string[] = []
  let open = ''

  for (const paragraph of text.trim().split(/\n\s*\n/)) {
    for (const piece of cut(paragraph, limit)) {
      if (open.length > 0 && open.length + 2 + piece.length > limit) {
        out.push(open)
        open = ''
      }
      open = open.length > 0 ? `${open}\n\n${piece}` : piece
    }
  }

  return open.length > 0 ? [...out, open] : out
}

export const tokens = (n: number | undefined | null) =>
  n === undefined || n === null ? 'unbekannt' : Math.round(n).toLocaleString('de-DE')
