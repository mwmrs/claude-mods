import { expect, mock, test } from 'claude-code/testing'

import { cacheView, chunks, ttlOf, weather } from '../hooks/logic'

const BAND = {
  plugin: 'context-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

const usage = (tokens: number) => ({
  startedAt: 0,
  rateLimits: [],
  context: {
    tokens,
    window: 200_000,
    percent: Math.round(tokens / 2000),
    breakdown: {
      autoCompactThreshold: 160_000,
      isAutoCompactEnabled: true,
      apiUsage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 90,
      },
    },
  },
})

test('the bar runs down green, yellow, red, expired', () => {
  expect(cacheView(0, 0, '5m')).toMatchObject({ minutes: 5, filled: 20, color: 'success' })
  expect(cacheView(0, 240_000, '5m')).toMatchObject({ minutes: 1, filled: 4, color: 'warning' })
  expect(cacheView(0, 280_000, '5m')).toMatchObject({ filled: 2, color: 'error', isExpired: false })
  expect(cacheView(0, 300_000, '5m')).toMatchObject({ minutes: 0, filled: 0, isExpired: true })
  expect(cacheView(0, 600_000, '1h')).toMatchObject({ minutes: 50, color: 'success' })
})

test('weather follows the share of the auto-compact threshold', () => {
  expect(weather(40, 80)).toBe('☀️')
  expect(weather(60, 80)).toBe('🌧️')
  expect(weather(70, 80)).toBe('⛈️')
  expect(weather(null, 83)).toBe('☀️')
})

test('the cache TTL is read off the last cache write', () => {
  const row = (h: number, m: number) =>
    `{"usage":{"cache_creation":{"ephemeral_1h_input_tokens":${h},"ephemeral_5m_input_tokens":${m}}}}`
  expect(ttlOf([row(0, 50), row(80, 0), row(0, 0)].join('\n'))).toBe('1h')
  expect(ttlOf(row(0, 50))).toBe('5m')
  expect(ttlOf('{"text":"\\"ephemeral_1h_input_tokens\\":5"}')).toBe(null)
})

test('long summaries split at paragraphs and lose nothing', () => {
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Absatz ${i} ` + 'wort '.repeat(60).trim())
  const long = 'x'.repeat(4000)
  const parts = chunks([...paragraphs, long].join('\n\n'))
  expect(parts.every(part => part.length <= 1800)).toBe(true)
  expect(parts.join('').replace(/\s/g, '')).toBe([...paragraphs, long].join('').replace(/\s/g, ''))
  expect(parts[0]?.endsWith('wort')).toBe(true)
})

test('the band shows cache, hit rate, weather, fill and Compact on each surface', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => h($$.ui.resolve(e).Text, {}, 'beneath') as never)
  let used = 60_000
  on('session.usage', () => ({ value: usage(used) }) as never)
  on('turn.complete', () => ({ text: 'ok' }))
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^Cache (\d+ min|abgelaufen|–)$/ }))?.text).toBe('Cache 5 min')
    expect((await ui.find({ type: 'Text', text: /^■+$/ }))?.text).toBe('■'.repeat(20))
    expect((await ui.find({ type: 'Text', text: /^Cache-Hit/ }))?.text).toBe('Cache-Hit 90 %')
    expect((await ui.find({ type: 'Text', text: /^(☀️|🌧️|⛈️)$/ }))?.text).toBe('☀️')
    expect((await ui.find({ type: 'Text', text: /^Kontext/ }))?.text).toContain('Kontext 30 % / Auto-Compact 80 %')
    expect((await ui.find({ key: 'compact' }))?.props.variant).toBe('secondary')
    await ui.unmount()
  }

  used = 150_000
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^(☀️|🌧️|⛈️)$/ }))?.text).toBe('⛈️')
  expect((await ui.find({ key: 'compact' }))?.props.variant).toBe('primary')

  await clock.advance(4 * 60_000 + 1000)
  expect((await ui.find({ type: 'Text', text: /^Cache (\d+ min|abgelaufen|–)$/ }))?.text).toBe('Cache 1 min')
  expect((await ui.find({ type: 'Text', text: /^Cache (\d+ min|abgelaufen|–)$/ }))?.props.color).toBe('warning')
  await clock.advance(60_000)
  expect((await ui.find({ type: 'Text', text: /^Cache (\d+ min|abgelaufen|–)$/ }))?.text).toBe('Cache abgelaufen')

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Cache-Hit/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Kontext/ }))?.text).toBe('Kontext 75 %')
  await ui.unmount()
})

test('Compact compacts when idle, queues /compact while working, and logs the summary', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => h($$.ui.resolve(e).Text, {}, 'beneath') as never)
  on('session.usage', () => ({ value: usage(150_000) }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const logs: string[] = []
  const ran: string[] = []
  on('ui.log', (_, e) => (logs.push(e.text), { value: undefined }) as never)
  on('command.run', (_, e) => (ran.push(e.command), {}))
  on('session.compact', () => ({
    messages: [{ role: 'user', text: 'Erster Absatz.\n\nZweiter Absatz.', toolUses: [] }],
    tokensBefore: 150_000,
    tokensAfter: 12_000,
  }))

  const idle = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await idle.press({ key: 'compact' })
  expect(ran).toEqual([])
  expect(logs[0]).toBe('Compact: 150.000 Tokens vorher → 12.000 Tokens nachher')
  expect(logs[1]).toContain('Erster Absatz.\n\nZweiter Absatz.')
  expect((await idle.find({ type: 'Text', text: /^Kontext/ }))?.text).toContain('Kontext 6 %')
  await idle.unmount()

  const busy = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: true } })
  await busy.press({ key: 'compact' })
  expect(ran).toEqual(['compact'])
  await busy.unmount()

  const app = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await app.press({ key: 'compact' })
  expect(ran).toEqual(['compact', 'compact'])

  logs.length = 0
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  expect(logs[0]).toBe('Compact: 150.000 Tokens vorher → 12.000 Tokens nachher')
})

test('without a readable transcript the TTL last read in any session is used, marked as assumed', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on, { ttl: '1h' })
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => h($$.ui.resolve(e).Text, {}, 'beneath') as never)
  on('session.usage', () => ({ value: usage(60_000) }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('turn.complete', () => ({ text: 'ok' }))
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Cache/ }))?.text).toBe('Cache 60 min')
  expect(await ui.find({ type: 'Text', text: /^\(1h\?\)$/ })).toBeDefined()
})
