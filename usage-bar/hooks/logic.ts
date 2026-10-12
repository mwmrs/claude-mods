import type { Limit } from '../types'

export const CELLS = 10
export const LEVELS = [90, 75] as const

const ORDER = ['five_hour', 'seven_day']

export const label = (kind: string) =>
  kind === 'five_hour' ? '' : kind === 'seven_day' ? 'Woche' : kind.replace(/^seven_day_/, 'Woche ').replaceAll('_', ' ')

export const limitName = (kind: string) =>
  kind === 'five_hour' ? 'Sitzungslimit' : kind === 'seven_day' ? 'Wochenlimit' : `${label(kind)}-Limit`

export const sorted = (limits: readonly Limit[]) =>
  [...limits].sort((a, b) => {
    const [x, y] = [ORDER.indexOf(a.kind), ORDER.indexOf(b.kind)]

    return (x < 0 ? ORDER.length : x) - (y < 0 ? ORDER.length : y)
  })

/** A window whose reset has passed since the reading counts as empty. */
export const percentAt = (limit: Limit, now: number) => {
  const resets = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

  return resets <= now ? 0 : limit.percentUsed
}

export const color = (percent: number) => (percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'success')

export const filled = (percent: number) =>
  percent <= 0 ? 0 : Math.min(CELLS, Math.max(1, Math.round((percent / 100) * CELLS)))

export const level = (percent: number) => LEVELS.find(l => percent >= l) ?? 0

export const duration = (ms: number) => {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`
}

export const resetText = (limit: Limit, now: number) => {
  const resets = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
  if (Number.isNaN(resets) || resets <= now) {
    return ''
  }
  if (limit.kind === 'five_hour') {
    return `Reset in ${duration(resets - now)}`
  }
  const date = new Date(resets)
  const day = date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

  return `Reset ${day} ${time}`
}
