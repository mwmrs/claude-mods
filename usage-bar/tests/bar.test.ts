import { expect, mock, test } from 'claude-code/testing'

import { color, duration, filled, label, level, percentAt, resetText, sorted } from '../hooks/logic'

const NOW = Date.parse('2026-10-12T10:00:00Z')
const BAND = {
  plugin: 'usage-bar',
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

const limits = (five: number, week: number) => [
  { kind: 'seven_day', percentUsed: week, resetsAt: '2026-10-15T09:00:00Z' },
  { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-12T12:14:00Z' },
]

const measure = (five: number, week: number) => ({
  context: { window: 200_000 },
  rateLimits: limits(five, week),
  changed: ['rateLimits' as const],
})

test('colours, cells, levels and labels', () => {
  expect([color(10), color(75), color(90)]).toEqual(['success', 'warning', 'error'])
  expect([filled(0), filled(3), filled(42), filled(100), filled(140)]).toEqual([0, 1, 4, 10, 10])
  expect([level(50), level(75), level(95)]).toEqual([0, 75, 90])
  expect([label('five_hour'), label('seven_day'), label('seven_day_opus')]).toEqual(['', 'Woche', 'Woche opus'])
  expect(sorted(limits(1, 2)).map(l => l.kind)).toEqual(['five_hour', 'seven_day'])
})

test('reset texts and a window past its reset', () => {
  const [week, five] = limits(42, 18)
  expect(resetText(five!, NOW)).toBe('Reset in 2 h 14 min')
  expect(resetText(week!, NOW)).toMatch(/^Reset (Mi|Do|Fr) \d\d:\d\d$/)
  expect(percentAt(five!, NOW)).toBe(42)
  expect(percentAt(five!, NOW + 3 * 3_600_000)).toBe(0)
  expect(duration(59_000)).toBe('1 min')
})

test('the row shows both windows on each surface, keeps the band beneath, and collapses', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)

    return h(Text, {}, 'beneath') as never
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure(measure(42, 18))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^beneath$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^■+$/ }))?.text).toBe('■■■■')
    expect((await ui.find({ type: 'Text', text: /^42 %$/ }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /^Woche 18 %$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Nutzung$/ }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /^\(Reset in 2 h 14 min\)$/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(60 * 60_000)
  expect(await ui.find({ type: 'Text', text: /^\(Reset in 1 h 14 min\)$/ })).toBeDefined()
  await ui.press({ key: 'usage-toggle' })
  expect(await ui.find({ type: 'Text', text: /^■+$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^42 %$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Woche 18 %/ })).toBeDefined()
  await ui.unmount()
})

test('one hint per window at 75 % and at 90 %', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(String((e as { text?: string }).text ?? e)), { value: undefined }) as never)

  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => h($$.ui.resolve(e).Text, {}, 'beneath') as never)
  await $.session.measure(measure(60, 10))
  await $.session.measure(measure(76, 10))
  await $.session.measure(measure(80, 10))
  await $.session.measure(measure(91, 10))
  expect(toasts).toHaveLength(2)
  expect(toasts[0]).toContain('Sitzungslimit zu 76 %')
  expect(toasts[1]).toContain('Sitzungslimit zu 91 %')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^91 %$/ }))?.props.color).toBe('error')
  await $.session.measure(measure(100, 10))
  expect(await ui.find({ type: 'Text', text: /^Limit erreicht$/ })).toBeDefined()
})

test('a fresh session shows the last known values, dim, with their age', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { reading: { limits: limits(42, 18), at: NOW - 12 * 60_000, isStale: false } })
  on('session.usage', () => ({ value: { startedAt: NOW, rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => h($$.ui.resolve(e).Text, {}, 'beneath') as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Stand vor 12 min$/ })).toBeDefined()
  const percent = await ui.find({ type: 'Text', text: /^42 %$/ })
  expect(percent?.props.dimColor).toBe(true)
  expect(percent?.props.color).toBeUndefined()
})
