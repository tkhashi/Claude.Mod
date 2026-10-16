import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { cells, readGit, render, type Git, type Input } from './statusline.ts'

const strip = (s: string) => s.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '')

const input: Input = {
  workspace: { current_dir: '/Users/me/work/project' },
  context_window: { context_window_size: 1_000_000, used_percentage: 12 },
  rate_limits: { five_hour: { used_percentage: 41 }, seven_day: { used_percentage: 85 } },
  pr: { number: 123, url: 'https://github.com/o/r/pull/123', review_state: 'approved' },
}
const git: Git = { branch: 'feature/statusline', ahead: 2, behind: 1, changes: 3 }
const ctx = (width: number, g: Git | null = git) => ({ width, home: '/Users/me', git: g })

test('every row fits the terminal width at any width', () => {
  for (const width of [200, 140, 100, 80, 60, 40, 30, 24]) {
    for (const row of strip(render(input, ctx(width))).split('\n')) {
      assert.ok(cells(row) <= width - 1, `row of ${cells(row)} cells @${width}: ${row}`)
    }
  }
})

test('the workplace row comes first, then the indicators, at any width', () => {
  for (const width of [200, 70]) {
    const rows = strip(render(input, ctx(width))).split('\n')
    assert.equal(rows.length, 2, `@${width}`)
    assert.match(rows[0]!, /~\/work\/project/)
    assert.match(rows[1]!, /41%.*85%/)
  }
})

test('only the workplace row without indicators', () => {
  const rows = strip(render({ ...input, context_window: undefined, rate_limits: undefined }, ctx(200))).split('\n')
  assert.equal(rows.length, 1)
})

test('workplace reads like the indicators: orange icon or label, then the value', () => {
  const out = render(input, ctx(200))
  const text = strip(out)
  assert.match(text, /^\u{f07c} ~\/work\/project  \u{f418} feature\/statusline ↑2 ↓1 ±3  pr:#123/u)
  assert.ok(out.includes('\x1b[38;2;218;119;86m\u{f07c} '), 'folder icon in Claude orange')
  assert.ok(out.includes('\x1b[38;2;218;119;86m\u{f418} '), 'branch icon in Claude orange')
  assert.ok(out.includes('\x1b[32m ↑2'), 'ahead is green')
  assert.ok(out.includes('\x1b]8;;https://github.com/o/r/pull/123\x1b\\'), 'PR is an OSC 8 link')
  assert.ok(out.includes('\x1b[32m#123'), 'approved PR is green')
  assert.doesNotMatch(text, /[\u{e0b0}-\u{e0bf}]/u, 'no powerline joints')
  assert.doesNotMatch(out, /\x1b\[48;/, 'no filled backgrounds')
})

test('a clean branch shows a check, and no git means path only', () => {
  assert.match(strip(render(input, ctx(200, { ...git, ahead: 0, behind: 0, changes: 0 }))), /\u{f418} feature\/statusline ✓/u)
  const text = strip(render({ ...input, pr: undefined }, ctx(200, null))).split('\n')[0]!
  assert.equal(text.trimEnd(), '\u{f07c} ~/work/project')
})

test('a project without a PR shows none', () => {
  assert.doesNotMatch(strip(render({ ...input, pr: undefined }, ctx(200))), /pr:/)
})

test('indicators look like the old statusline: orange label, six-cell bar, percent', () => {
  const out = render(input, ctx(200))
  const text = strip(out)
  assert.match(text, /5h:\[██░░░░\] 41% 7d:\[█████░\] 85% ctx:\[░░░░░░\] 12% ac:\[░░░░░░\] 13%/)
  assert.ok(out.includes('\x1b[38;2;218;119;86m5h:'), 'label in Claude orange')
})

test('indicator colors: own color below 50%, yellow from 50%, red from 80%', () => {
  const paint = (five: number) => render({ ...input, context_window: undefined, rate_limits: { five_hour: { used_percentage: five } } }, ctx(200))
  assert.ok(paint(41).includes('\x1b[35m[██░░░░] 41%'), '5h magenta')
  assert.ok(paint(55).includes('\x1b[33m[███░░░] 55%'), 'yellow')
  assert.ok(paint(85).includes('\x1b[31m[█████░] 85%'), 'red')
})

test('narrow, the indicators drop their bars and then wrap, and an unknown plan shows none', () => {
  const pct = strip(render(input, ctx(36)))
  assert.match(pct, /5h:41% 7d:85% ctx:12% ac:13%/)
  const wrapped = strip(render(input, ctx(24))).split('\n')
  assert.ok(wrapped.length > 2, 'one row per few indicators')
  assert.match(wrapped.join(' '), /5h:41%.*7d:85%/)
  const noPlan = strip(render({ ...input, rate_limits: undefined }, ctx(200)))
  assert.doesNotMatch(noPlan, /5h:|7d:/)
  assert.match(noPlan, /ctx:/)
})

test('context indicator is empty rather than missing before the first response', () => {
  const text = strip(render({ ...input, rate_limits: undefined, context_window: { context_window_size: 200_000, used_percentage: null } }, ctx(200)))
  assert.match(text, /ctx:\[░░░░░░\] 0%/)
})

test('wide characters count as two cells', () => {
  assert.equal(cells('日本語'), 6)
  const text = strip(render({ ...input, workspace: { current_dir: '/Users/me/日本語のとても長いディレクトリ名/project' } }, ctx(50)))
  for (const row of text.split('\n')) assert.ok(cells(row) <= 49, row)
})

test('readGit reads branch, upstream counts and changes in one call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' })
  assert.equal(readGit(dir), null, 'not a repository')
  run('init', '-b', 'main')
  writeFileSync(join(dir, 'a'), '1')
  run('add', 'a')
  run('commit', '-m', 'first')
  writeFileSync(join(dir, 'b'), '2')
  writeFileSync(join(dir, 'a'), '3')
  assert.deepEqual(readGit(dir), { branch: 'main', ahead: 0, behind: 0, changes: 2 })
  run('checkout', '--detach')
  assert.match(readGit(dir)!.branch, /^[0-9a-f]{7}$/)
})

test('the command reads stdin JSON and COLUMNS', () => {
  const script = fileURLToPath(new URL('./statusline.ts', import.meta.url))
  const out = execFileSync('node', [script], { input: JSON.stringify(input), env: { ...process.env, COLUMNS: '120', HOME: '/Users/me' }, encoding: 'utf8' })
  assert.match(strip(out), /41%/)
  assert.equal(execFileSync('node', [script], { input: 'not json', encoding: 'utf8' }), '')
})

test('the command also runs through a symlink, as from ~/.claude', () => {
  const script = fileURLToPath(new URL('./statusline.ts', import.meta.url))
  const link = join(mkdtempSync(join(tmpdir(), 'statusline-link-')), 'statusline.ts')
  symlinkSync(script, link)
  const out = execFileSync('node', [link], { input: JSON.stringify(input), env: { ...process.env, COLUMNS: '120', HOME: '/Users/me' }, encoding: 'utf8' })
  assert.match(strip(out), /41%/)
})
