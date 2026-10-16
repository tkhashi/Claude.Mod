import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellsOf, dockColumns, fit, headLines, inlineRows, isMid, metaOf, midsOf, pageOf, pagesOf, plainOf, shellOutline, spokenOf, toolLine, turnOf, turnsOf } from './register'

// モデルが読む会話(API 形式)。プロンプトにはエンジンのリマインダーが付く。1つ
// 目のターンは、thinking の後に Read と Grep、thinking と途中の発言の後に Bash
// (失敗)、最後に答え。2つ目のターンはツールを呼ばない答えだけ。
const MESSAGES = [
  {
    role: 'user',
    content: [
      { type: 'text', text: '<system-reminder>\nToday is Monday.\n</system-reminder>' },
      { type: 'text', text: 'fix the bug' },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Look at the parser first.', signature: 's1' },
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/repo/a.ts' } },
      { type: 'tool_use', id: 'toolu_2', name: 'Grep', input: { pattern: 'parse', path: '/repo' } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'line 1\nline 2\n\n<system-reminder>\n100 tokens left\n</system-reminder>' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'a.ts:3' }] },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'The off-by-one is in the loop bound.', signature: 's2' },
      { type: 'text', text: 'Found it.' },
      { type: 'tool_use', id: 'toolu_3', name: 'Bash', input: { command: 'npm test', description: 'run tests' } },
    ],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: Array.from({ length: 12 }, (_, i) => `FAIL ${i}`).join('\n'), is_error: true }],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  { role: 'user', content: [{ type: 'text', text: 'now run the linter' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Lint is clean.' }] },
]

// 畳まれた行が持つ呼び出し(1つ目の応答の2つ)。
const CALLS = [
  { tool_use_id: 'toolu_1', tool: 'Read', input: { file_path: '/repo/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: { type: 'text' } },
  { tool_use_id: 'toolu_2', tool: 'Grep', input: { pattern: 'parse' }, isRunning: false, isErrored: false, isInterrupted: false, output: { numFiles: 1 } },
]
const BASH = { tool_use_id: 'toolu_3', tool: 'Bash', input: { command: 'npm test', description: 'run tests' }, isRunning: false, isErrored: true, isInterrupted: false, output: 'FAIL' }

// プラグインの下にあるエンジン部分。本体の行の描画、会話、ペインの開け閉め。
const engine = (on: On, opened: any[], closed: string[], messages: unknown[] = MESSAGES) => {
  let up = false
  // 本体が最後に描いた各行の props。
  const drew: Record<string, any> = {}
  const own = (component: string) => async ($: any, e: any) => {
    drew[component] = e.props
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">{`engine ${component}`}</Text>
  }
  on('ui.render', { component: 'ToolGroup' }, own('ToolGroup'))
  on('ui.render', { component: 'ToolUse' }, own('ToolUse'))
  on('ui.render', { component: 'ToolResult' }, own('ToolResult'))
  on('ui.render', { component: 'AssistantMessage' }, own('AssistantMessage'))
  on('ui.render', { component: 'UserMessage' }, own('UserMessage'))
  on('session.messages', async () => ({ value: messages }) as any)
  on('agent.list', async () => ({ value: [] }) as any)
  on('ui.open', async (_$, e) => {
    opened.push(e)
    up = true
    return { value: { isPlaced: true } } as any
  })
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    up = false
    return { value: undefined } as any
  })
  on('ui.panes', async () => ({ value: up ? [{ id: 'peek', title: 'Peek', isShown: true, isFocused: true, isPlaced: true }] : [] }) as any)
  on('ui.scroll', async () => ({ value: {} }) as any)
  on('ui.focus', async () => ({ value: {} }) as any)
  on('clock.sleep', async () => ({ value: undefined }) as any)
  on('clock.after', async () => ({ value: undefined }) as any)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as any)
  mock.store(on)
  return drew
}

const mount = ($: any, component: string, props: Record<string, unknown>, requestId?: string) =>
  $.ui.mount({ plugin: 'peek', surface: 'terminal', component, props, viewport: { columns: 100, rows: 50 }, ...(requestId ? { requestId } : {}) } as any)

const group = ($: any, calls: unknown[], extra: Record<string, unknown> = {}) =>
  mount($, 'ToolGroup', { calls, isActive: false, isExpanded: false, ...extra })

const tool = ($: any, row: { tool_use_id: string; [field: string]: unknown }) => mount($, 'ToolUse', row, row.tool_use_id)

const pane = ($: any, bodyColumns = 70, placement = 'dock') =>
  $.ui.mount({
    plugin: 'peek',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'peek',
    props: { title: 'Peek', isFocused: true, bodyColumns, placement, scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as any)

const peek = ($: any, columns = 70, args = '') =>
  $.command.run({ command: 'peek', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns } } as any)

const pos = async (ui: any) => (await ui.find({ key: 'peek-pos' }))?.text.trim()
const markdown = async (ui: any) => (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.props.text)
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
const label = async (ui: any, key: string) => (await ui.find({ key }))?.text
// エンジンが描いた行か。
const engines = async (ui: any, component: string) => (await ui.find({ type: 'Text', text: `engine ${component}` })) !== undefined
// 塗られている(選ばれている)詳しさのボタンの名前。
const current = async (ui: any) => (await ui.findAll({ type: 'Text' })).find((t: any) => t.props.color === '#1e1e2e')?.text.trim()

test('the conversation splits into turns: a prompt, the steps that follow, and Claude’s last message', () => {
  const turns = turnsOf(MESSAGES as any)
  expect(turns.map(t => t.prompt)).toEqual(['fix the bug', 'now run the linter'])
  expect(turns[0]?.steps.map(s => (s.kind === 'call' ? [s.call.tool, s.call.result] : s.kind === 'redacted' ? [s.kind] : [s.kind, s.text]))).toEqual([
    ['thinking', 'Look at the parser first.'],
    ['Read', 'line 1\nline 2'],
    ['Grep', 'a.ts:3'],
    ['thinking', 'The off-by-one is in the loop bound.'],
    ['text', 'Found it.'],
    ['Bash', 'FAIL 0\nFAIL 1\nFAIL 2\nFAIL 3\nFAIL 4\nFAIL 5\nFAIL 6\nFAIL 7\nFAIL 8\nFAIL 9\nFAIL 10\nFAIL 11'],
    ['text', 'Done.'],
  ])
  expect(turns.map(t => t.reply)).toEqual([6, 0])
  const bash = turns[0]?.steps[5]
  expect(bash?.kind === 'call' && bash.call.isError).toBe(true)
  expect(turnOf(turns, { ids: ['toolu_3'] })).toEqual({ at: 0, step: 5, key: 'peek-step-0-5' })
  expect(turnOf(turns, { thought: 'The off-by-one is in the loop bound.' })).toEqual({ at: 0, step: 3, key: 'peek-step-0-3' })
  expect(turnOf(turns, { ids: ['toolu_9'] })).toBeNull()

  // 要約は発言の言い換え。一番近い途中の発言を指す。
  const said = turnsOf([
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'text', text: '追加依頼了解。ToolGroup を本家同様 1呼び出し1行に展開、Bash はコマンド名だけの要約に書き換える。' }, { type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
    { role: 'assistant', content: [{ type: 'text', text: '1呼び出し1行に展開した。' }] },
  ] as any)
  expect(turnOf(said, { thought: 'ToolGroup を1呼び出し1行に展開し、Bashはコマンド名だけの要約形式にします。' })).toEqual({ at: 0, step: 0, key: 'peek-step-0-0' })
  expect(turnOf(said, { thought: 'Something unrelated entirely.' })).toBeNull()

  // 発言の後にまだ呼び出しが続くターンでも、最後の発言が答え。続く分はその後。
  const running = turnsOf([
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'text', text: 'One moment.' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }] },
  ] as any)
  expect(running[0]?.reply).toBe(0)
  expect(running[0]?.steps.map(s => s.kind)).toEqual(['text', 'call'])
  expect(running[0]?.steps[0]).toEqual({ kind: 'text', text: 'Checking.\n\nOne moment.' })
})

test('what the person typed is kept; reminders and command output are not', () => {
  expect(spokenOf('<system-reminder>\nx\n</system-reminder>')).toBe('')
  expect(
    spokenOf(
      '<local-command-caveat>Caveat</local-command-caveat>\n<command-name>/reload-plugins</command-name>\n<command-message>reload-plugins</command-message>\n<command-args></command-args>\n<local-command-stdout>Reloaded</local-command-stdout>',
    ),
  ).toBe('/reload-plugins')
  expect(spokenOf('<command-name>/model</command-name><command-args>opus</command-args>')).toBe('/model opus')
  const turns = turnsOf([
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: {} }] },
    { role: 'user', content: [{ type: 'text', text: '<system-reminder>only a reminder</system-reminder>' }] },
  ] as any)
  expect(turns.map(t => t.prompt)).toEqual(['look\n\n[image]'])
})

test('lines: a call keeps its name and note and cuts its argument; a shell command keeps its names and joins', () => {
  expect(shellOutline('cd /repo && ls -la && cat a.txt | grep foo')).toBe('cd .. && ls .. && cat .. | grep ..')
  expect(shellOutline('ls')).toBe('ls')
  expect(shellOutline('FOO=1 npm test 2>&1 | tail -5; echo "exit $?"')).toBe('npm .. | tail ..; echo ..')
  expect(shellOutline('echo "a && b | c" | wc -l'), 'operators in quotes are words').toBe('echo .. | wc ..')
  expect(shellOutline('npx tsc -p $(git rev-parse --show-toplevel) || exit 1')).toBe('npx .. || exit ..')
  expect(shellOutline("cat <<'EOF' > f.txt\nrm -rf && x | y\nEOF\nnode f.txt"), 'a heredoc body is skipped').toBe('cat ..; node ..')
  expect(shellOutline('(cd sub && make) || true')).toBe('(cd .. && make) || true')
  expect(shellOutline('sleep 5 &')).toBe('sleep .. &')
  expect(shellOutline('/usr/local/bin/uv run x.py # run it\n"$HOME/bin/tool"')).toBe('uv ..; tool')
  expect(shellOutline('if [ -f a ]; then rm a; fi')).toBe('if [ ..; then rm ..; fi')
  expect(shellOutline('git status \\\n  --short')).toBe('git ..')
  expect(plainOf('The **off-by-one** is in `loop`.')).toBe('The off-by-one is in loop.')
  expect(plainOf('除外: `**/.claude-plugin/types/` と **型**')).toBe('除外: **/.claude-plugin/types/ と 型')
  expect(cellsOf('途中経過abc')).toBe(11)
  expect(fit('途中経過を表示する', 9)).toBe('途中経過…')
  expect(fit('short', 9)).toBe('short')

  expect(metaOf({ isErrored: true, isInterrupted: false })).toBe('error')
  expect(metaOf({ isErrored: false, isInterrupted: true })).toBe('interrupted')
  expect(metaOf({ isErrored: false, isInterrupted: false, output: { backgroundTaskId: 'b1', returnCodeInterpretation: 'No matches' } })).toBe(
    'background, No matches',
  )
  expect(toolLine('Write', { file_path: '/repo/a.ts', content: 'x\ny' }, '', 80)).toBe('(/repo/a.ts)')
  expect(toolLine('Write', { file_path: `/${'deep/'.repeat(20)}hello.txt` }, '', 40), 'a path keeps its file name').toEqual(
    expect.stringMatching(/^\(…[a-z/]*\/hello\.txt\)$/),
  )
  expect(fit('途中経過を表示する', 9, true)).toBe('…表示する')
  expect(toolLine('Bash', { command: 'git add -A && git commit -m "x && y"', description: 'commit' }, '', 80)).toBe('(git .. && git ..)')
  const long = toolLine('Grep', { pattern: 'x'.repeat(200) }, 'error', 40)
  expect(long.endsWith('…)')).toBe(true)
  expect(cellsOf(long)).toBeLessThanOrEqual(40 - 4 - 2 - cellsOf('Grep') - ' · error'.length - 3)
})

test('the pane asks for a sidebar share when wide and a third or so of a tall screen inline; a window fits its budget', () => {
  expect(dockColumns(110)).toBe(42)
  expect(dockColumns(300)).toBe(72)
  expect(dockColumns(80)).toBe(36)
  expect(inlineRows(60)).toBe(24)
  expect(inlineRows(12)).toBe(8)
  expect(headLines('a\nb\nc\n', 2)).toEqual({ lines: ['a', 'b'], more: 1 })

})

test('a page runs from one of Claude’s messages to the next; a turn still running ends on an open page', () => {
  const pages = pagesOf(turnsOf(MESSAGES as any))
  expect(pages).toEqual([
    { turn: 0, before: -1, steps: [0, 1, 2, 3], after: 4 },
    { turn: 0, before: 4, steps: [5], after: 6 },
    { turn: 1, before: -1, steps: [], after: 0 },
  ])
  expect(pageOf(pages, 0, 1), 'a call').toBe(0)
  expect(pageOf(pages, 0, 4), 'a message leads the page after it').toBe(1)
  expect(pageOf(pages, 0, 6), 'the last message ends its page').toBe(1)
  expect(pageOf(pages, 1, 0)).toBe(2)
  const running = pagesOf(
    turnsOf([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }] },
    ] as any),
  )
  expect(running).toEqual([
    { turn: 0, before: -1, steps: [], after: 0 },
    { turn: 0, before: 0, steps: [1], after: -1 },
  ])
  expect(pagesOf(turnsOf([{ role: 'user', content: [{ type: 'text', text: 'go' }] }] as any)), 'a prompt with nothing yet').toEqual([{ turn: 0, before: -1, steps: [], after: -1 }])
})

test('/peek opens the latest page under its prompt; the pager walks the pages between Claude’s messages', async ($, on) => {
  const opened: any[] = []
  const closed: string[] = []
  engine(on, opened, closed)
  await peek($)
  expect(opened.map(o => [o.id, o.focus, o.closeOnEscape])).toEqual([['peek', true, true]])
  const ui = await pane($)
  expect(await pos(ui)).toBe('Turn 2/2 · page 1/1')
  expect(await texts(ui)).toContain('now run the linter')
  expect(await texts(ui), 'only the page’s own prompt').not.toContain('fix the bug')
  expect(await markdown(ui)).toEqual(['Lint is clean.'])
  expect((await ui.find({ key: 'peek-prompt-1' }))?.props, 'its empty border rows folded into the gaps').toMatchObject({
    borderStyle: 'quote',
    borderColor: '#89dceb',
    backgroundColor: '#2d3948',
    paddingY: 1,
    marginY: -1,
  })
  expect((await ui.find({ key: 'peek-step-1-0' }))?.props, 'the last message tinted Claude’s color, as in the transcript').toMatchObject({ borderColor: '#d97757', backgroundColor: '#312732' })

  await ui.press({ key: 'peek-prev' })
  expect(await pos(ui)).toBe('Turn 1/2 · page 2/2')
  expect(await texts(ui), 'the turn’s prompt on top').toContain('fix the bug')
  expect(await markdown(ui), 'from the message before the steps to the one after').toEqual(['Found it.', 'Done.'])
  expect((await ui.find({ key: 'peek-step-0-4' }))?.props.backgroundColor, 'a message along the way on gray').toBe('#303030')
  expect((await ui.find({ key: 'peek-step-0-6' }))?.props.backgroundColor).toBe('#312732')
  expect(await texts(ui), 'a call shows its header line alone').not.toContain('FAIL 0')
  await ui.press({ key: 'peek-call-0-5' })
  expect(await texts(ui), 'the header line shows the input and the result').toContain('FAIL 0')
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  expect((await ui.find({ key: 'peek-step-0-5-head' }))?.props.backgroundColor).toBe('#2b303b')
  expect((await ui.find({ key: 'peek-step-0-5-out' }))?.props.backgroundColor, 'a failed result is tinted').toBe('#3b2226')
  await ui.press({ key: 'peek-call-0-5' })
  expect(await texts(ui)).not.toContain('FAIL 0')

  await ui.press({ key: 'peek-prev-foot' })
  expect(await pos(ui)).toBe('Turn 1/2 · page 1/2')
  expect(await markdown(ui)).toEqual(['Look at the parser first.', 'The off-by-one is in the loop bound.', 'Found it.'])
  expect((await ui.find({ key: 'peek-step-0-0' }))?.props.backgroundColor, 'thinking has none').toBeUndefined()
  expect(await label(ui, 'peek-seg-0-1-result')).toBe(' ▸ 2 lines ')
  await ui.press({ key: 'peek-seg-0-1-result' })
  expect(await texts(ui), 'the result, without the reminder').toContain('line 2')
  expect(await texts(ui)).not.toContain('100 tokens left')
  expect(await ui.find({ type: 'Code' }), 'the input stays folded').toBeUndefined()
  await ui.press({ key: 'peek-prev' })
  expect(await pos(ui), 'the first page stays').toBe('Turn 1/2 · page 1/2')

  await ui.press({ key: 'peek-next' })
  await ui.press({ key: 'peek-next-foot' })
  expect(await pos(ui)).toBe('Turn 2/2 · page 1/1')
  await ui.press({ key: 'peek-prev' })
  await ui.press({ key: 'peek-latest' })
  expect(await pos(ui)).toBe('Turn 2/2 · page 1/1')
  await ui.unmount()

  await peek($)
  expect(closed).toEqual(['peek'])

  await peek($)
  const again = await pane($, 80)
  expect(await label(again, 'peek-close'), 'a close button wider than the frame’s mark, with no second ✕').toBe('  close  ')
  await again.press({ key: 'peek-close' })
  expect(closed).toEqual(['peek', 'peek'])
  await again.unmount()
})

test('a long prompt shows its first lines until pressed', async ($, on) => {
  const prompt = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
  engine(on, [], [], [
    { role: 'user', content: [{ type: 'text', text: prompt }] },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  ])
  await peek($)
  const ui = await pane($)
  const shown = (await texts(ui)).join('\n')
  expect(shown).toContain('line 5')
  expect(shown).not.toContain('line 6')
  expect(await label(ui, 'peek-prompt-more')).toBe('… +4 lines')
  await ui.press({ key: 'peek-prompt-more' })
  expect((await texts(ui)).join('\n')).toContain('line 9')
  await ui.unmount()
})

test('a folded group unfolds, so each call draws as its own row; pressing a row twice opens and closes its turn', async ($, on) => {
  const opened: any[] = []
  const closed: string[] = []
  const drew = engine(on, opened, closed)
  const grouped = await group($, CALLS)
  expect(await engines(grouped, 'ToolGroup')).toBe(true)
  expect(drew.ToolGroup?.isExpanded).toBe(true)
  await grouped.unmount()

  const row = await tool($, CALLS[0]!)
  await row.press({ key: 'peek-open' })
  expect(opened).toHaveLength(1)
  const ui = await pane($)
  expect(await ui.find({ key: 'peek-step-0-1' }), 'the Read it was sent to').toBeDefined()
  expect(await texts(ui), 'the pressed call’s result').toContain('line 2')
  expect(await texts(ui), 'the other calls stay folded').not.toContain('a.ts:3')
  expect(await ui.find({ key: 'peek-step-1-0' }), 'other turns are on other pages').toBeUndefined()
  expect(await texts(ui), 'the prompt of its turn on top').toContain('fix the bug')
  expect(await markdown(ui), 'up to the next message of Claude’s').toEqual(['Look at the parser first.', 'The off-by-one is in the loop bound.', 'Found it.'])
  await ui.unmount()

  await row.press({ key: 'peek-open' })
  expect(closed).toEqual(['peek'])
  await row.unmount()
})

test('Claude’s messages draw with a gutter: a message a tool call followed on gray, the turn’s last one tinted', async ($, on) => {
  engine(on, [], [])
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'Checking the ' } as any
    yield { kind: 'text', index: 0, text: 'tests now.' } as any
    yield { kind: 'tool', index: 1, id: 't9', name: 'Bash' } as any
    return { turnId: e.turnId, index: e.index, answer: 'Checking the tests now.', toolUses: [{ name: 'Bash', input: {} }], stopReason: 'tool_use', usage: null } as any
  })
  expect(midsOf(turnsOf(MESSAGES as any)), 'a message followed by a call; not the last one').toEqual(['Found it.'])
  expect(isMid(['Found it. Then the second block of the same message.'], 'Then the second block of the same message.')).toBe(true)
  expect(isMid(['Found it.'], 'Found'), 'too short to match a part').toBe(false)

  const live = await mount($, 'AssistantMessage', { text: 'Checking the tests now.', isFirstOfReply: true })
  const last = await mount($, 'AssistantMessage', { text: 'Done.', isFirstOfReply: true })
  const bg = async (ui: any) => (await ui.find({ key: 'peek-gutter' }))?.props.backgroundColor
  expect((await live.find({ key: 'peek-gutter' }))?.props).toMatchObject({ borderStyle: 'quote', borderColor: '#d97757', paddingX: 1, paddingTop: 1, paddingBottom: 1 })
  expect(await bg(live)).toBeUndefined()
  expect(await markdown(live)).toEqual(['Checking the tests now.'])
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any)) {
  }
  expect(await bg(live), 'gray once a call follows it').toBe('#303030')
  expect(await bg(last), 'the turn’s last message, read from the conversation').toBe('#312732')
  expect(await engines(live, 'AssistantMessage')).toBe(false)
  await live.unmount()
  await last.unmount()
})

test('your prompts draw with a sky-blue gutter on a blue-gray band; other parties’ rows are the engine’s', async ($, on) => {
  engine(on, [], [])
  const typed = await mount($, 'UserMessage', { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  expect((await typed.find({ key: 'peek-gutter' }))?.props).toMatchObject({ borderStyle: 'quote', borderColor: '#89dceb', backgroundColor: '#2d3948', paddingX: 1, paddingTop: 1 })
  expect(await typed.find({ key: 'peek-levels' }), 'the level buttons fill its last row').toBeDefined()
  expect(await texts(typed)).toContain('fix the bug')
  const told = await mount($, 'UserMessage', { text: 'hi', origin: { kind: 'peer' }, from: { kind: 'agent' }, isExpanded: false })
  expect(await engines(told, 'UserMessage')).toBe(true)
  await typed.unmount()
  await told.unmount()
})

test('a single tool row folds to one line and its result block is hidden; pressing it opens its turn', async ($, on) => {
  const opened: any[] = []
  engine(on, opened, [])
  const row = await tool($, BASH)
  expect((await row.find({ key: 'peek-row' }))?.text).toEqual(expect.stringMatching(/^●Bash\(npm \.\.\) · error/))
  expect(await engines(row, 'ToolUse')).toBe(false)
  const result = await mount($, 'ToolResult', { tool_use_id: 'toolu_3', tool: 'Bash', output: 'FAIL', isErrored: true }, 'toolu_3')
  expect(await engines(result, 'ToolResult')).toBe(false)
  expect(await result.find({ key: 'peek-result' })).toBeDefined()

  await row.press({ key: 'peek-open' })
  expect(opened).toHaveLength(1)
  const ui = await pane($)
  expect(await ui.find({ key: 'peek-step-0-5' })).toBeDefined()
  expect(await pos(ui), 'the page between the messages before and after it').toBe('Turn 1/2 · page 2/2')
  expect(await texts(ui)).toContain('FAIL 11')
  await ui.unmount()
  await result.unmount()
  await row.unmount()
})

test('a summary row opens the turn whose steps hold its thinking; other replies are the engine’s', async ($, on) => {
  const opened: any[] = []
  engine(on, opened, [])
  const summary = await mount($, 'AssistantMessage', { text: 'The off-by-one is in the loop bound.', isFirstOfReply: true, isSummary: true })
  expect((await summary.find({ key: 'peek-summary' }))?.props).toMatchObject({ marginTop: 1, marginBottom: 1 })
  expect((await summary.find({ key: 'peek-summary-band' }))?.props).toMatchObject({ backgroundColor: 'ansi256(236)' })
  await summary.press({ key: 'peek-open' })
  expect(opened).toHaveLength(1)
  const ui = await pane($)
  expect(await ui.find({ key: 'peek-step-0-3' })).toBeDefined()
  expect(await markdown(ui)).toContain('The off-by-one is in the loop bound.')
  await ui.unmount()
  await summary.unmount()

  const reply = await mount($, 'AssistantMessage', { text: 'Done.', isFirstOfReply: true })
  expect(await engines(reply, 'AssistantMessage')).toBe(false)
  expect(await markdown(reply)).toEqual(['Done.'])
  await reply.unmount()
})

test('a row the conversation does not hold yet shows what the row holds', async ($, on) => {
  engine(on, [], [])
  const row = await tool($, { tool_use_id: 'toolu_9', tool: 'Write', input: { file_path: '/repo/new.ts', content: 'x' }, isRunning: true, isErrored: false, isInterrupted: false })
  await row.press({ key: 'peek-open' })
  const ui = await pane($)
  expect(await pos(ui)).toBe('Turn 3/3 · page 1/1')
  expect(await label(ui, 'peek-note')).toEqual(expect.stringMatching(/Not in the conversation yet/))
  expect(await ui.find({ key: 'peek-step-2-0' })).toBeDefined()
  expect(await texts(ui)).toContain('running…')
  await ui.unmount()
  await row.unmount()
})

test('under ctrl+o or --verbose the rows are left to the engine', async ($, on) => {
  engine(on, [], [])
  const grouped = await group($, CALLS, { isExpanded: true })
  expect(await engines(grouped, 'ToolGroup')).toBe(true)
  expect(await grouped.find({ key: 'peek-open' })).toBeUndefined()
  await grouped.unmount()

  const told = await mount($, 'UserMessage', { text: 'hi', origin: { kind: 'peer' }, from: { kind: 'agent' }, isExpanded: true })
  const folded = await tool($, BASH)
  expect(await engines(folded, 'ToolUse'), 'another party’s row says nothing of ctrl+o').toBe(false)
  await folded.unmount()
  await told.unmount()
  const prompt = await mount($, 'UserMessage', { text: 'fix the bug', origin: { kind: 'sdk' }, isExpanded: true })
  const row = await tool($, BASH)
  expect(await engines(row, 'ToolUse')).toBe(true)
  await row.unmount()
  await prompt.unmount()
  const back = await mount($, 'UserMessage', { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  await back.unmount()
})

test('a narrow pane above the prompt keeps to short, cut lines', async ($, on) => {
  engine(on, [], [])
  const row = await tool($, { ...BASH, output: { stdout: '', stderr: 'FAIL' } })
  await row.press({ key: 'peek-open' })
  const wide = await pane($, 70, 'dock')
  // 見せている行を囲む枠。左の辺は本体がペインの左に引く縦線(幅を変えるときにつか
  // む所)で、左の角は右と同じ角丸をその上に描く。見出しは上の辺に、前後のページ
  // へのボタンは下の辺に埋め込む。内側は押せるよう、上下と右の辺は分けてある。
  const topEdge = (await wide.find({ key: 'peek-frame-top' }))?.text ?? ''
  expect(topEdge).toEqual(expect.stringMatching(/^╭─ Turn 1\/2 · page 2\/2 ─+.*─╮$/))
  expect((await wide.find({ key: 'peek-frame-top' }))?.props, 'its corner on the engine’s line').toMatchObject({ position: 'absolute', top: 0, left: -1, width: 71 })
  expect((await wide.find({ key: 'peek-frame-bottom' }))?.text).toEqual(expect.stringMatching(/^╰─ ◂ previous ─+ next ▸ ─╯$/))
  expect((await wide.find({ key: 'peek-frame-bottom' }))?.props).toMatchObject({ position: 'absolute', top: 29, left: -1 })
  expect((await wide.find({ key: 'peek-frame-right' }))?.props).toMatchObject({ position: 'absolute', left: 69, height: 28 })
  expect(await wide.find({ key: 'peek-frame-left' }), 'the engine’s line is the left side, so it can still be dragged').toBeUndefined()
  expect((await wide.find({ type: 'Text', text: '╭─' }))?.props.color, 'the engine’s color for a pane with the keys').toBe('permission')
  expect(await wide.find({ type: 'Code' }), 'the input as JSON in a wide dock').toBeDefined()
  expect(await texts(wide)).toContain('FAIL 11')
  // 閉じて、狭いターミナルで開き直したもの。
  await wide.press({ key: 'peek-close' })
  await wide.unmount()
  const idle = await $.ui.mount({
    plugin: 'peek',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'peek',
    props: { title: 'Peek', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as any)
  expect((await idle.find({ type: 'Text', text: '╭─' }))?.props, 'dim, as the engine’s line, without the keys').toMatchObject({ dimColor: true })
  await idle.unmount()
  await row.press({ key: 'peek-open' })
  const slim = await pane($, 30, 'inline')
  expect(await slim.find({ key: 'peek-frame-top' }), 'above the prompt the engine’s own frame is enough').toBeUndefined()
  expect((await slim.find({ key: 'peek-head-bar' }))?.props.top, 'the header still pinned').toBe(0)
  expect(await pos(slim)).toBe('1·2/2')
  expect(await slim.find({ type: 'Code' }), 'no JSON when narrow').toBeUndefined()
  const shown = await texts(slim)
  expect(shown).toContain('FAIL 3')
  expect(shown).not.toContain('FAIL 4')
  expect(shown).toContain('… +8 lines')
  await slim.unmount()
  await row.unmount()
})

test('on the latest page it moves on to new pages as the conversation runs; on an earlier one it stays', async ($, on) => {
  const messages: unknown[] = [...MESSAGES]
  engine(on, [], [], messages)
  await peek($)
  const ui = await pane($)
  expect(await pos(ui)).toBe('Turn 2/2 · page 1/1')
  messages.push(
    { role: 'user', content: [{ type: 'text', text: 'and the docs' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Reading them.' }, { type: 'tool_use', id: 'toolu_7', name: 'Read', input: { file_path: '/repo/README.md' } }] },
  )
  await ui.press({ key: 'peek-reload' })
  expect(await pos(ui), 'the page after Claude’s newest message').toBe('Turn 3/3 · page 2/2')
  expect(await texts(ui)).toContain('and the docs')
  expect(await markdown(ui)).toEqual(['Reading them.'])

  await ui.press({ key: 'peek-prev' })
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_7', content: '# docs' }] }, { role: 'assistant', content: [{ type: 'text', text: 'They are fine.' }] })
  await ui.press({ key: 'peek-reload' })
  expect(await pos(ui), 'an earlier page stays put').toBe('Turn 3/3 · page 1/2')
  await ui.press({ key: 'peek-next' })
  expect(await markdown(ui)).toEqual(['Reading them.', 'They are fine.'])
  await ui.unmount()
})

test('four levels: 1 leaves every row to the engine, 2 folds the tool calls, 3 hides them, 4 also Claude’s messages along the way; the buttons on any prompt or answer switch the whole transcript', async ($, on) => {
  const messages: unknown[] = [...MESSAGES]
  const drew = engine(on, [], [], messages)
  let chunks: unknown[] = []
  on('turn.step', async function* (_$, e) {
    for (const c of chunks) yield c as any
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null } as any
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }) as any)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any)) {
  }
  await $.turn.complete({ turnId: 't1', answer: 'Done.', durationMs: 1, isAborted: false, reason: 'answer' } as any)

  const prompt = await mount($, 'UserMessage', { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  const calls = [await tool($, CALLS[0]!), await tool($, BASH)]
  const result = await mount($, 'ToolResult', { tool_use_id: 'toolu_3', tool: 'Bash', output: 'FAIL', isErrored: true }, 'toolu_3')
  const grouped = await group($, CALLS)
  const step = await mount($, 'AssistantMessage', { text: 'Found it.', isFirstOfReply: true })
  const summary = await mount($, 'AssistantMessage', { text: 'The off-by-one is in the loop bound.', isFirstOfReply: true, isSummary: true })
  const answer = await mount($, 'AssistantMessage', { text: 'Done.', isFirstOfReply: true })
  const other = await tool($, { ...BASH, tool_use_id: 'toolu_x' })
  const shown = async (ui: any) => (await ui.find({ key: 'peek-hidden' })) === undefined

  expect((await prompt.find({ key: 'peek-levels' }))?.text).toBe('show  all  cpt tool  no tools  answers ')
  expect(await current(prompt), 'the tool calls fold by default').toBe('cpt tool')
  expect(await current(answer), 'the answer has the buttons too').toBe('cpt tool')
  expect(await step.find({ key: 'peek-levels' }), 'a message along the way has none').toBeUndefined()
  for (const row of [...calls, step, summary, answer]) expect(await shown(row)).toBe(true)
  for (const row of calls) expect(await row.find({ key: 'peek-row' })).toBeDefined()
  expect(await result.find({ key: 'peek-result' })).toBeDefined()

  await prompt.press({ key: 'peek-level-1' })
  expect(await current(prompt)).toBe('all')
  expect(await current(answer)).toBe('all')
  for (const row of calls) expect(await engines(row, 'ToolUse'), 'level 1 leaves the calls to the engine').toBe(true)
  expect(await engines(result, 'ToolResult'), 'their results too').toBe(true)
  expect(await engines(grouped, 'ToolGroup')).toBe(true)
  expect(drew.ToolGroup?.isExpanded, 'a group still unfolds, so nothing stays folded').toBe(true)
  expect((await step.find({ key: 'peek-gutter' }))?.props.backgroundColor, 'the messages keep their colors').toBe('#303030')
  expect(await summary.find({ key: 'peek-summary' })).toBeDefined()

  await answer.press({ key: 'peek-level-3' })
  expect(await current(prompt)).toBe('no tools')
  expect(await current(answer)).toBe('no tools')
  for (const row of calls) expect(await shown(row), 'level 3 hides the calls').toBe(false)
  expect(await other.find({ key: 'peek-row' }), 'a call the conversation does not hold (a subagent’s) keeps its line').toBeDefined()
  for (const row of [step, summary, answer]) expect(await shown(row)).toBe(true)
  expect((await step.find({ key: 'peek-gutter' }))?.props.backgroundColor).toBe('#303030')

  await answer.press({ key: 'peek-level-4' })
  expect(await current(prompt)).toBe('answers')
  for (const row of [...calls, step, summary]) expect(await shown(row), 'level 4 leaves the prompt and the answer').toBe(false)
  expect((await answer.find({ key: 'peek-gutter' }))?.props.backgroundColor).toBe('#312732')

  // 進んでいるターンの呼び出しは、届いたそばから隠す。
  messages.push({ role: 'user', content: [{ type: 'text', text: 'and the docs' }] })
  chunks = [
    { kind: 'text', index: 0, text: 'Reading them.' },
    { kind: 'tool', index: 1, id: 'toolu_7', name: 'Read' },
  ]
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'm', messageCount: 9 } as any)) {
  }
  const live = await tool($, { tool_use_id: 'toolu_7', tool: 'Read', input: { file_path: '/repo/README.md' }, isRunning: true, isErrored: false, isInterrupted: false })
  const said = await mount($, 'AssistantMessage', { text: 'Reading them.', isFirstOfReply: true })
  expect(await shown(live)).toBe(false)
  expect(await shown(said)).toBe(false)

  await prompt.press({ key: 'peek-level-3' })
  expect(await current(answer)).toBe('no tools')
  expect(await shown(said), 'back at 3, the messages along the way return').toBe(true)
  expect((await peek($, 70, '2'))?.text).toBe('Level 2: prompts, Claude’s messages, tool calls folded to one line, and answers')
  for (const row of [...calls, live]) expect(await row.find({ key: 'peek-row' })).toBeDefined()
  expect((await peek($, 70, '1'))?.text).toBe('Level 1: everything as Claude Code draws it: prompts, Claude’s messages, tool calls with their results, and answers')
  for (const row of [...calls, live]) expect(await engines(row, 'ToolUse')).toBe(true)
  for (const row of [prompt, ...calls, result, grouped, step, summary, answer, other, live, said]) await row.unmount()
})

test('a level the version with three levels kept keeps its meaning: its all is now cpt tool', async ($, on) => {
  mock.store(on, { level: 1 })
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as any)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as any)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as any)
  const prompt = await mount($, 'UserMessage', { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  expect(await current(prompt)).toBe('cpt tool')
  await prompt.unmount()
})

test('under ctrl+o every row is drawn whatever the level, and the prompt has no level buttons', async ($, on) => {
  engine(on, [], [])
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as any)) {
  }
  await peek($, 70, '4')
  const prompt = await mount($, 'UserMessage', { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: true })
  expect(await prompt.find({ key: 'peek-levels' })).toBeUndefined()
  const step = await mount($, 'AssistantMessage', { text: 'Found it.', isFirstOfReply: true })
  expect(await step.find({ key: 'peek-gutter' })).toBeDefined()
  const row = await tool($, CALLS[1]!)
  expect(await engines(row, 'ToolUse')).toBe(true)
  for (const ui of [prompt, step, row]) await ui.unmount()
  const back = await mount($, 'UserMessage', { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false })
  await back.unmount()
})

test('opened on a narrow terminal the pane sits above the prompt and docks once widened; a docked pane the terminal narrows under closes', async ($, on) => {
  const closed: string[] = []
  engine(on, [], closed)
  // 前のテストで右にドックしていたペインを閉じておく。
  const before = await pane($)
  await before.press({ key: 'peek-close' })
  await before.unmount()
  closed.length = 0
  const row = await tool($, BASH)
  await row.press({ key: 'peek-open' })
  const above = await pane($, 80, 'inline')
  expect(await pos(above), 'drawn above the prompt').toBe('Turn 1/2 · page 2/2')
  await above.unmount()
  const docked = await pane($, 60, 'dock')
  expect(await docked.find({ key: 'peek-frame-top' }), 'moved to the right once wide').toBeDefined()
  await docked.unmount()
  expect(closed).toEqual([])
  const narrowed = await pane($, 80, 'inline')
  expect(await narrowed.find({ key: 'peek-closing' }), 'not drawn above the prompt').toBeDefined()
  expect(await narrowed.find({ key: 'peek-pos' })).toBeUndefined()
  await narrowed.unmount()
  expect(closed).toEqual(['peek'])
  await row.unmount()
})
