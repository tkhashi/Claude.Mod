import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// プラグインの下にあるエンジン部分。本体の描画、モデルのステップ、ストア、時計。
const engine = (on: On, ran: { command: string; args: string }[] = []) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-band">engine band</Text>
  })
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-hint">{e.props.hint}</Text>
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as any
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }) as any)
  on('command.run', async (_$, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' } as any
  })
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
}

const step = async ($: any, model: string, effort: string) => {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1 })) {
    // 読み捨てる。
  }
}

// ボタンはプロンプト下のヒント行の右端に出る。
const mountHint = ($: any, columns: number, text = '') =>
  $.ui.mount({
    plugin: 'statusbar-buttons',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: text },
    viewport: { columns, rows: 40 },
  } as any)

// 押して開く選択肢と一覧は、プロンプト上の帯に出る。
const mountBand = ($: any, bodyColumns = 120) =>
  $.ui.mount({
    plugin: 'statusbar-buttons',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns, scroll: { bodyRows: 20 } },
  } as any)

test('nothing is drawn until a model is known, then the buttons are joined blocks at the right of the hint line', async ($, on) => {
  engine(on)
  const empty = await mountHint($, 120, 'esc to interrupt')
  expect(await empty.find({ type: 'Button', key: 'model' }), 'no buttons yet').toBeUndefined()
  expect(await empty.find({ type: 'Text', text: 'esc to interrupt' }), 'the engine hint is left alone').toBeDefined()
  await empty.unmount()

  await step($, 'claude-sonnet-5-5[1m]', 'high')
  const ui = await mountHint($, 160, 'esc to interrupt')
  for (const key of ['model', 'effort', 'wt', 'ag']) {
    expect(await ui.find({ type: 'Button', key }), `${key} button`).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /esc to interrupt/ }), 'the hint stays on the left').toBeDefined()
  const row = (await ui.find({ type: 'Box', key: 'buttons' }))?.text ?? ''
  expect(row.match(/\u{e0b6}/gu)?.length, 'an opening cap before each of the four blocks').toBe(4)
  expect(row.trimEnd().endsWith('\u{e0b4}'), 'no closing cap: the right end is flat').toBe(false)
  expect(row.indexOf('Sonnet') < row.indexOf('high') && row.indexOf('high') < row.indexOf('\u{f0531}'), 'model, effort, worktrees').toBe(true)
  await ui.unmount()
})

test('the model shortens as the line narrows, and the buttons never vanish', async ($, on) => {
  engine(on)
  await step($, 'claude-sonnet-5-5[1m]', 'high')
  const text = async (columns: number) => {
    const ui = await mountHint($, columns)
    const row = (await ui.find({ type: 'Box', key: 'buttons' }))?.text ?? ''
    await ui.unmount()
    return row
  }
  expect(await text(160), 'context size when wide').toEqual(expect.stringMatching(/Sonnet 5\.5 1M.*high/))
  expect(await text(40), 'name only').toEqual(expect.stringMatching(/Sonnet 5\.5/))
  expect(await text(30), 'initial and version').toEqual(expect.stringMatching(/S5\.5/))
  expect(await text(20), 'model and effort at the narrowest').toEqual(expect.stringMatching(/S5\.5.*high/))
})

test('pressing model or effort opens a picker above the prompt that runs the command', async ($, on) => {
  const ran: { command: string; args: string }[] = []
  engine(on, ran)
  await step($, 'Sonnet 5.5', 'high')
  const buttons = await mountHint($, 120)
  const band = await mountBand($)

  await buttons.press({ key: 'model' })
  expect(await band.find({ type: 'Text', text: '✓ Sonnet' }), 'current model checked').toBeDefined()
  await band.press({ key: 'pick-opus' })
  expect(ran).toEqual([{ command: 'model', args: 'opus' }])
  expect(await band.find({ type: 'Text', text: '✓ Sonnet' }), 'picker closed').toBeUndefined()

  await buttons.press({ key: 'effort' })
  expect(await band.find({ type: 'Text', text: '✓ High' }), 'current effort checked').toBeDefined()
  await band.press({ key: 'pick-max' })
  expect(ran[1]).toEqual({ command: 'effort', args: 'max' })
  expect((await buttons.find({ type: 'Box', key: 'buttons' }))?.text).toEqual(expect.stringMatching(/max/))
  await buttons.unmount()
  await band.unmount()
})

test('worktrees and subagents open one at a time, and a row press closes them', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  const buttons = await mountHint($, 120)
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: /^Worktrees$/ }), 'hidden by default').toBeUndefined()
  await buttons.press({ key: 'wt' })
  expect(await band.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees open').toBeDefined()
  await buttons.press({ key: 'ag' })
  expect(await band.find({ type: 'Text', text: /^Subagents$/ }), 'subagents open').toBeDefined()
  expect(await band.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees closed by it').toBeUndefined()
  await band.press({ key: 'ag-h-b' })
  expect(await band.find({ type: 'Text', text: /^Subagents$/ }), 'closed by a row press').toBeUndefined()
  await buttons.unmount()
  await band.unmount()
})

test('one list is open at a time: a picker and a drawer close each other', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  const buttons = await mountHint($, 120)
  const band = await mountBand($)
  await buttons.press({ key: 'model' })
  expect(await band.find({ type: 'Text', text: '✓ Sonnet' }), 'model picker open').toBeDefined()
  await buttons.press({ key: 'wt' })
  expect(await band.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees open').toBeDefined()
  expect(await band.find({ type: 'Text', text: '✓ Sonnet' }), 'model picker closed by it').toBeUndefined()
  await buttons.press({ key: 'effort' })
  expect(await band.find({ type: 'Text', text: /^Worktrees$/ }), 'worktrees closed by the effort picker').toBeUndefined()
  await buttons.unmount()
  await band.unmount()
})

test('the band above the prompt draws nothing of its own while no list is open', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  const band = await mountBand($)
  expect(await band.find({ type: 'Box', key: 'lists' })).toBeUndefined()
  expect(await band.find({ type: 'Button', key: 'model' }), 'no buttons up here').toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'engine band' }), 'the engine band is left alone').toBeDefined()
  await band.unmount()
})

test('a typed /effort shows on the button at once', async ($, on) => {
  engine(on)
  await step($, 'Sonnet 5.5', 'high')
  await $.command.run({ command: 'effort', args: 'medium' } as any)
  const ui = await mountHint($, 120)
  expect((await ui.find({ type: 'Box', key: 'buttons' }))?.text).toEqual(expect.stringMatching(/medium/))
  await ui.unmount()
})
