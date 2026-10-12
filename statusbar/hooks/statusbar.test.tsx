import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fitGauges } from './register'

// The engine beneath the plugin: its own drawings, a model step, the store and clock.
const engine = (on: On, ran: { command: string; args: string }[] = []) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-band" />
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-reply" />
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as any
  })
  on('command.run', async (_$, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' } as any
  })
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
}

const step = async ($: any, model: string, effort: string) => {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1 })) {
    // drain
  }
}

const band = ($: any, bodyColumns: number) =>
  $.ui.mount({
    plugin: 'statusbar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns, scroll: { bodyRows: 20 } },
  } as any)

test('band is hidden until a model is known, then keeps to two rows at any width', async ($, on) => {
  engine(on)
  const empty = await band($, 120)
  expect(await empty.find({ type: 'Text', text: 'Sonnet' })).toBeUndefined()
  await empty.unmount()

  await step($, 'claude-sonnet-5-5[1m]', 'high')
  for (const bodyColumns of [160, 90, 40, 24]) {
    const ui = await band($, bodyColumns)
    const first = await ui.find({ type: 'Box', key: 'r0' })
    expect(first?.text, `model and effort on row 0 @${bodyColumns}`).toEqual(expect.stringMatching(/(Sonnet 5\.5|S5\.5).*high/))
    expect(await ui.find({ type: 'Text', text: '\uf07c' }), `path @${bodyColumns}`).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'r1' }), `row 1 @${bodyColumns}`).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'r2' }), `no third row without spare gauges @${bodyColumns}`).toBeUndefined()
    await ui.unmount()
  }
  const wide = await band($, 160)
  expect((await wide.find({ type: 'Box', key: 'r0' }))?.text, 'context size and effort when wide').toEqual(
    expect.stringMatching(/Sonnet 5\.5 1M.*high/),
  )
  expect(await wide.find({ type: 'Box', key: 'pr' }), 'PR status icon').toBeDefined()
  await wide.unmount()
})

test('worktrees and subagents open one at a time, and a row press closes them', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  const ui = await band($, 120)
  expect(await ui.find({ type: 'Text', text: /^Worktrees$/ }), 'hidden by default').toBeUndefined()
  await ui.press({ key: 'wt' })
  expect(await ui.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees open').toBeDefined()
  await ui.press({ key: 'ag' })
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ }), 'subagents open').toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees closed by it').toBeUndefined()
  await ui.press({ key: 'ag-h-b' })
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ }), 'closed by a row press').toBeUndefined()
  await ui.unmount()
})

test('the person\'s prompts have a gutter of their own', async ($, on) => {
  engine(on)
  on('ui.render', { component: 'UserMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-user" />
  })
  const msg = await $.ui.mount({
    plugin: 'statusbar',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'fix the band', origin: { kind: 'composer' }, isExpanded: false },
  } as any)
  expect(await msg.find({ type: 'Text', text: 'fix the band' })).toBeDefined()
  expect(await msg.find({ type: 'Box', key: 'gutter' })).toBeDefined()
  await msg.unmount()
})

test('one list is open at a time: a picker and a drawer close each other', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  const ui = await band($, 120)
  await ui.press({ key: 'model' })
  expect(await ui.find({ type: 'Text', text: '✓ Sonnet' }), 'model picker open').toBeDefined()
  await ui.press({ key: 'wt' })
  expect(await ui.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees open').toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ Sonnet' }), 'model picker closed by it').toBeUndefined()
  await ui.press({ key: 'effort' })
  expect(await ui.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees closed by the effort picker').toBeUndefined()
  await ui.unmount()
})

test('compact mode puts the band on one row and back', async ($, on) => {
  engine(on)
  await step($, 'claude-sonnet-5-5[1m]', 'high')
  const ui = await band($, 120)
  await ui.press({ key: 'compact' })
  const row = (await ui.find({ type: 'Box', key: 'r0' }))?.text
  expect(row, 'model, effort and path on one row').toEqual(expect.stringMatching(/Sonnet 5\.5.*high.*\uf07c/))
  expect(await ui.find({ type: 'Box', key: 'r1' }), 'no second row').toBeUndefined()
  await ui.press({ key: 'compact' })
  expect(await ui.find({ type: 'Box', key: 'r1' }), 'two rows again').toBeDefined()
  await ui.unmount()
})

test('narrow, the model is its initial and version; compact keeps its switch at the right end at any width', async ($, on) => {
  engine(on)
  await step($, 'claude-sonnet-5-5[1m]', 'high')
  const narrow = await band($, 30)
  expect((await narrow.find({ type: 'Box', key: 'r0' }))?.text).toEqual(expect.stringMatching(/S5\.5/))
  await narrow.press({ key: 'compact' })
  for (const bodyColumns of [120, 50, 30, 22]) {
    const ui = await band($, bodyColumns)
    expect(await ui.find({ type: 'Button', key: 'compact' }), `the switch back @${bodyColumns}`).toBeDefined()
    expect((await ui.find({ type: 'Box', key: 'r0' }))?.text?.trimEnd().endsWith('\uf065'), `last on the row @${bodyColumns}`).toBe(true)
    await ui.unmount()
  }
  await narrow.unmount()
})

test('a list opens above the band, the status rows kept below it', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  const ui = await band($, 120)
  await ui.press({ key: 'model' })
  expect(await ui.find({ type: 'Box', key: 'lists' }), 'the list block').toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'r0' }), 'status rows still drawn').toBeDefined()
  await ui.unmount()
})

test('a typed /effort shows on the band at once', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  await $.command.run({ command: 'effort', args: 'medium' } as any)
  const ui = await band($, 120)
  expect((await ui.find({ type: 'Box', key: 'r0' }))?.text).toEqual(expect.stringMatching(/medium/))
  await ui.unmount()
})

test('pressing model or effort opens a picker that runs the command', async ($, on) => {
  const ran: { command: string; args: string }[] = []
  engine(on, ran)
  await step($, 'Sonnet 5.5', 'high')
  const ui = await band($, 120)

  await ui.press({ key: 'model' })
  expect(await ui.find({ type: 'Text', text: '✓ Sonnet' }), 'current model checked').toBeDefined()
  await ui.press({ key: 'pick-opus' })
  expect(ran).toEqual([{ command: 'model', args: 'opus' }])
  expect(await ui.find({ type: 'Text', text: '✓ Sonnet' }), 'picker closed').toBeUndefined()

  await ui.press({ key: 'effort' })
  expect(await ui.find({ type: 'Text', text: '✓ High' }), 'current effort checked').toBeDefined()
  await ui.press({ key: 'pick-max' })
  expect(ran[1]).toEqual({ command: 'effort', args: 'max' })
  expect((await ui.find({ type: 'Box', key: 'r0' }))?.text).toEqual(expect.stringMatching(/max/))
  await ui.unmount()
})

test('replies have Claude\'s gutter', async ($, on) => {
  engine(on)
  await step($, 'Opus 5.5', 'max')
  const reply = await $.ui.mount({
    plugin: 'statusbar',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'hello **world**', isFirstOfReply: true },
  } as any)
  expect(await reply.find({ type: 'Markdown', text: 'hello' })).toBeDefined()
  expect(await reply.find({ type: 'Box', key: 'gutter' })).toBeDefined()
  await reply.unmount()
})

test('every gauge shows before any is dropped, within the room, at any width', () => {
  const g = (key: string, pct: number, weight: number, label = key, short = key) =>
    ({ key, icon: 'x', label, short, pct, base: '#ffffff', extra: null, weight }) as any
  const all = [g('5h', 42, 3), g('7d', 7, 3), g('ctx', 12, 1, 'Ctx', 'Ctx'), g('ac', 13, 1, 'Auto-compact', 'AC')]
  const width = (segs: any[]) => segs.reduce((n, x) => n + x.parts.reduce((m: number, p: any) => m + [...p.text].length, 0) + 1, 0)
  for (const room of [120, 80, 60, 45, 36]) {
    const segs = fitGauges(all, room)
    expect(segs.map((x: any) => x.key), `all four @${room}`).toEqual(['5h', '7d', 'ctx', 'ac'])
    expect(width(segs) <= room, `within ${room}: ${width(segs)}`).toBe(true)
  }
  const tight = fitGauges(all, 20)
  expect(tight.length < 4 && tight.length > 0, 'the last left out only when even chips do not fit').toBe(true)
  expect(width(tight) <= 20).toBe(true)
})

test('narrow, 5h and 7d outlast ctx and ac, down to bare percentages', () => {
  const g = (key: string, pct: number, weight: number, label = key, short = key) =>
    ({ key, icon: 'x', label, short, pct, base: '#ffffff', extra: null, weight }) as any
  const all = [g('5h', 42, 3), g('7d', 7, 3), g('ctx', 12, 1, 'Ctx', 'Ctx'), g('ac', 13, 1, 'Auto-compact', 'AC')]
  expect(fitGauges(all, 14).map((x: any) => x.key), 'the plan first').toEqual(['5h', '7d'])
  expect(fitGauges(all, 28).map((x: any) => x.key), 'all four as bare percentages').toEqual(['5h', '7d', 'ctx', 'ac'])
})

test('at the narrowest the compact switch still shows on row 0', async ($, on) => {
  engine(on)
  await step($, 'claude-sonnet-5-5[1m]', 'high')
  const ui = await band($, 20)
  expect((await ui.find({ type: 'Box', key: 'r0' }))?.text?.trimEnd().endsWith('\uf066')).toBe(true)
  await ui.unmount()
})
