import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionCompactResult, SessionMessage } from 'claude-code'

import type { CacheTtl, ContextFill } from '../types'
import {
  CELLS,
  FALLBACK_THRESHOLD,
  STORM,
  cacheView,
  chunks,
  tokens,
  ttlOf,
  weather,
} from './logic'

const COLLAPSED_KEY = 'isCollapsed'
const NO_CONTEXT: ContextFill = {
  percent: null,
  thresholdPercent: FALLBACK_THRESHOLD,
  isThresholdRead: false,
}

const lastAt = atom({ plugin: 'context-bar', key: 'lastAt' } as const, null)
const ttl = atom({ plugin: 'context-bar', key: 'ttl' } as const, null)
const hitRate = atom({ plugin: 'context-bar', key: 'hitRate' } as const, null)
const context = atom({ plugin: 'context-bar', key: 'context' } as const, NO_CONTEXT)
const isCollapsed = atom({ plugin: 'context-bar', key: 'isCollapsed' } as const, false)
const tick = atom({ plugin: 'context-bar', key: 'tick' } as const, 0)

type Engine = EngineInterface

const summaryOf = (messages: readonly SessionMessage[]) =>
  messages.find(m => m.role === 'user' && m.text.trim().length > 0)?.text ?? ''

let timer: { cancel: () => void } | undefined
let transcriptPath: string | undefined
// What classic.PostCompact handed over during the compaction under way.
let postSummary: string | undefined
let reports = 0

const startTimer = ($: Engine) => {
  timer ??= $.clock.every(60_000, () => void update($, tick, n => n + 1))
}

const measure = async ($: Engine, tokensNow?: number) => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const { window, breakdown } = usage.context
  const used = tokensNow ?? usage.context.tokens
  const percent =
    used !== undefined && window > 0 ? (used / window) * 100 : (usage.context.percent ?? null)
  const threshold = breakdown?.autoCompactThreshold
  const isThresholdRead = threshold !== undefined && window > 0
  const fill: ContextFill = {
    percent,
    thresholdPercent: isThresholdRead ? (threshold / window) * 100 : FALLBACK_THRESHOLD,
    isThresholdRead,
  }
  await update($, context, () => fill)

  const api = breakdown?.apiUsage
  if (api && tokensNow === undefined) {
    const input = api.input_tokens + api.cache_read_input_tokens + api.cache_creation_input_tokens
    await update($, hitRate, () => (input > 0 ? (api.cache_read_input_tokens / input) * 100 : null))
  }
}

const readTtl = async ($: Engine, path: string) => {
  transcriptPath = path
  let tail = ''
  try {
    tail = (await $.process.run(['tail', '-c', '600000', path], { timeoutMs: 5000 })).stdout
  } catch {
    tail = await $.fs.read(path).catch(() => '')
  }
  const found: CacheTtl | null = ttlOf(tail)
  if (found !== null) {
    await update($, ttl, () => found)
  }
}

const report = async ($: Engine, result: SessionCompactResult, before?: number) => {
  if (result.messages === undefined) {
    return
  }
  reports += 1
  const summary = (postSummary ?? summaryOf(result.messages)).trim()
  postSummary = undefined
  $.ui.log(
    `Compact: ${tokens(result.tokensBefore ?? before)} Tokens vorher → ${tokens(result.tokensAfter)} Tokens nachher`,
  )
  const parts = chunks(summary)
  parts.forEach((part, i) =>
    $.ui.log(parts.length > 1 ? `Zusammenfassung (${i + 1}/${parts.length})\n${part}` : `Zusammenfassung\n${part}`),
  )
  if (parts.length === 0) {
    $.ui.log('Zusammenfassung: keine gefunden.')
  }
  await measure($, result.tokensAfter).catch(() => undefined)
  await update($, hitRate, () => null)
}

const compact = async ($: Engine, isQueued: boolean) => {
  if (!isQueued) {
    const seen = reports
    postSummary = undefined
    try {
      const before = (await $.session.usage()).context.tokens
      const result = await $.session.compact()
      if ('skip' in result && result.skip !== undefined) {
        $.ui.toast(`Compact übersprungen: ${result.skip}`)
      } else if (reports === seen) {
        await report($, result, before)
      }

      return
    } catch {
      // A turn is running or the host takes no direct call: queue it instead.
    }
  }
  $.ui.toast('/compact ist eingereiht und startet, sobald Claude fertig ist')
  await $.command.run({ command: 'compact' }).catch(error => {
    $.ui.log(`context-bar: /compact ließ sich nicht einreihen (${String(error)})`)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    startTimer($)
    const stored = await $.store.get(COLLAPSED_KEY).catch(() => undefined)
    if (typeof stored === 'boolean') {
      await update($, isCollapsed, () => stored)
    }
    await measure($).catch(() => undefined)

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await readTtl($, e.transcript_path).catch(() => undefined)

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    await readTtl($, e.transcript_path).catch(() => undefined)

    return next(e)
  })

  on('classic.PostCompact', ($, e, next) => {
    postSummary = e.compact_summary

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A main-loop tool call follows a response: the cache was just refreshed.
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, lastAt, () => now)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      startTimer($)
      const now = await $.clock.now()
      await update($, lastAt, () => now)
      await measure($).catch(() => undefined)
      if (transcriptPath !== undefined) {
        await readTtl($, transcriptPath).catch(() => undefined)
      }
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') && e.context.tokens !== undefined) {
      await measure($).catch(() => undefined)
    }

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute' || e.agentId !== undefined) {
      return next(e)
    }
    postSummary = undefined
    const before = (await $.session.usage().catch(() => undefined))?.context.tokens
    const result = await next(e)
    await report($, result, before).catch(() => undefined)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    await read($, tick)
    const at = await read($, lastAt)
    const fill = await read($, context)
    const rate = await read($, hitRate)
    const cacheTtl = await read($, ttl)
    const collapsed = await read($, isCollapsed)
    const now = await $.clock.now()
    // What the plugins beneath draw in the band stays, above this row.
    const beneath = await next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const sky = weather(fill.percent, fill.thresholdPercent)
    const cache = at === null ? null : cacheView(at, now, cacheTtl)
    const cacheText =
      cache === null ? 'Cache –' : cache.isExpired ? 'Cache abgelaufen' : `Cache ${cache.minutes} min`
    const percent = fill.percent === null ? '–' : `${Math.round(fill.percent)} %`
    const isWorking = e.props.isWorking

    const toggle = (
      <Button
        key="toggle"
        plain
        label={collapsed ? '▸' : '◂'}
        onPress={async () => {
          await update($, isCollapsed, () => !collapsed)
          await $.store.set(COLLAPSED_KEY, !collapsed).catch(() => undefined)
        }}
      />
    )

    const row = collapsed ? (
        <Box columnGap={2}>
          <Text>{sky}</Text>
          <Text color={cache?.color}>
            {cacheText}
          </Text>
          <Text>Kontext {percent}</Text>
          {toggle}
        </Box>
    ) : (
      <Box columnGap={2} flexWrap="wrap">
        <Box columnGap={1}>
          <Text color={cache?.color}>
            {cacheText}
          </Text>
          <Text>
            <Text color={cache?.color}>
              {'■'.repeat(cache?.filled ?? 0)}
            </Text>
            <Text dimColor>{'□'.repeat(CELLS - (cache?.filled ?? 0))}</Text>
          </Text>
          <Text dimColor>({cacheTtl ?? '5m?'})</Text>
        </Box>
        <Text>Cache-Hit {rate === null ? '–' : `${Math.round(rate)} %`}</Text>
        <Text>{sky}</Text>
        <Text>
          Kontext {percent}
          <Text dimColor>
            {' '}
            / Auto-Compact {Math.round(fill.thresholdPercent)} %{fill.isThresholdRead ? '' : ' (Standard)'}
          </Text>
        </Text>
        <Button
          key="compact"
          label="Compact"
          variant={sky === STORM ? 'primary' : 'secondary'}
          onPress={press => compact($, isWorking || press.surface !== 'terminal')}
        />
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
