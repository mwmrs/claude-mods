import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit, Reading } from '../types'
import { CELLS, color, duration, filled, label, level, limitName, percentAt, resetText, sorted } from './logic'

const READING_KEY = 'reading'
const WARNED_KEY = 'warned'
const COLLAPSED_KEY = 'isCollapsed'

const reading = atom({ plugin: 'usage-bar', key: 'reading' } as const, null)
const warned = atom({ plugin: 'usage-bar', key: 'warned' } as const, {})
const isCollapsed = atom({ plugin: 'usage-bar', key: 'isCollapsed' } as const, false)
const tick = atom({ plugin: 'usage-bar', key: 'tick' } as const, 0)

type Engine = EngineInterface

let timer: { cancel: () => void } | undefined

const startTimer = ($: Engine) => {
  timer ??= $.clock.every(60_000, () => void update($, tick, n => n + 1))
}

const isReading = (value: unknown): value is Reading =>
  typeof value === 'object' && value !== null && Array.isArray((value as Reading).limits)

const take = async ($: Engine, limits: readonly SessionRateLimit[]) => {
  if (limits.length === 0) {
    return
  }
  const at = await $.clock.now()
  const fresh: Reading = {
    limits: limits.map(({ kind, percentUsed, resetsAt }): Limit => ({ kind, percentUsed, resetsAt })),
    at,
    isStale: false,
  }
  await update($, reading, () => fresh)
  await $.store.set(READING_KEY, fresh).catch(() => undefined)

  const shown = await read($, warned)
  const next: Record<string, number> = {}
  for (const limit of fresh.limits) {
    const reached = level(limit.percentUsed)
    next[limit.kind] = reached
    if (reached > (shown[limit.kind] ?? 0)) {
      $.ui.toast(`${limitName(limit.kind)} zu ${Math.round(limit.percentUsed)} % verbraucht`)
    }
  }
  await update($, warned, () => next)
  await $.store.set(WARNED_KEY, next).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    startTimer($)
    const stored = await $.store.get(COLLAPSED_KEY).catch(() => undefined)
    if (typeof stored === 'boolean') {
      await update($, isCollapsed, () => stored)
    }
    const before = await $.store.get(WARNED_KEY).catch(() => undefined)
    if (typeof before === 'object' && before !== null) {
      await update($, warned, () => before as Record<string, number>)
    }
    const { rateLimits } = await $.session.usage()
    const last = await $.store.get(READING_KEY).catch(() => undefined)
    if (rateLimits.length > 0) {
      await take($, rateLimits)
    } else if (isReading(last) && (await read($, reading)) === null) {
      await update($, reading, () => ({ ...last, isStale: true }))
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    startTimer($)
    await take($, e.rateLimits).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await take($, (await $.session.usage()).rateLimits).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    await read($, tick)
    const now = await $.clock.now()
    const current = await read($, reading)
    const collapsed = await read($, isCollapsed)
    // What the plugins beneath draw in the band stays, above this row.
    const beneath = await next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const limits = sorted(current?.limits ?? [])
    const isStale = current?.isStale ?? false

    const toggle = (
      <Button
        key="usage-toggle"
        plain
        label={collapsed ? '▸' : '◂'}
        onPress={async () => {
          await update($, isCollapsed, () => !collapsed)
          await $.store.set(COLLAPSED_KEY, !collapsed).catch(() => undefined)
        }}
      />
    )

    const worst = Math.max(0, ...limits.map(limit => percentAt(limit, now)))
    const title = (
      <Text color={isStale || limits.length === 0 ? undefined : color(worst)} dimColor={isStale}>
        Nutzung
      </Text>
    )

    const row =
      current === null || limits.length === 0 ? (
        <Box columnGap={2}>
          {title}
          <Text dimColor>– (noch keine Werte)</Text>
        </Box>
      ) : collapsed ? (
        <Box columnGap={1}>
          {title}
          {limits.map((limit, i) => {
            const percent = percentAt(limit, now)

            return (
              <Text color={isStale ? undefined : color(percent)} dimColor={isStale}>
                {i > 0 ? '· ' : ''}
                {`${label(limit.kind)} ${Math.round(percent)} %`.trim()}
              </Text>
            )
          })}
          {toggle}
        </Box>
      ) : (
        <Box columnGap={2} flexWrap="wrap">
          {title}
          {limits.map(limit => {
            const percent = percentAt(limit, now)
            const cells = filled(percent)
            const tone = isStale ? undefined : color(percent)
            const reset = resetText(limit, now)

            return (
              <Box columnGap={1}>
                <Text color={tone} dimColor={isStale}>
                  {`${label(limit.kind)} ${percent >= 100 ? 'Limit erreicht' : `${Math.round(percent)} %`}`.trim()}
                </Text>
                <Text>
                  <Text color={tone} dimColor={isStale}>
                    {'■'.repeat(cells)}
                  </Text>
                  <Text dimColor>{'□'.repeat(CELLS - cells)}</Text>
                </Text>
                {reset !== '' && <Text dimColor>({reset})</Text>}
              </Box>
            )
          })}
          {isStale && <Text dimColor>Stand vor {duration(now - (current?.at ?? now))}</Text>}
          {toggle}
        </Box>
      )

    if (typeof beneath !== 'object' || beneath === null) {
      return row
    }

    return (
      <Box flexDirection="column">
        {beneath}
        {row}
      </Box>
    )
  })
}
