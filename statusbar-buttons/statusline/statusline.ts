#!/usr/bin/env node
// Claude Code の statusLine 用コマンド。作業場所・git・PR と使用量のインジケータを、
// 昔の statusline-command.sh と同じ見た目(オレンジのラベルに値を続ける。
// ` ~/work  main ±3`、`ctx:[██░░░░] 12%`)で出す。押せるもの(model・effort・worktree・サブエージェント)は statusbar-buttons mod
// が受け持つ。
//
// stdin に statusLine の JSON を受け取り、ANSI 色付きの行を標準出力へ返す。幅は環境変
// 数 COLUMNS から取る(Claude Code が実行前に設定する)。
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Input = {
  cwd?: string
  workspace?: { current_dir?: string }
  context_window?: { context_window_size?: number; used_percentage?: number | null }
  rate_limits?: {
    five_hour?: { used_percentage?: number }
    seven_day?: { used_percentage?: number }
  }
  pr?: { number?: number; url?: string; review_state?: string }
}

export type Git = { branch: string; ahead: number; behind: number; changes: number }

// ラベルの色。昔の statusline と同じ Claude のオレンジ。
const ORANGE = '#da7756'

// Nerd Font のアイコン。パスとブランチのラベルに使う。
const ICON = { dir: '\u{f07c}', git: '\u{f418}' }

// `sgr` は 16 色の ANSI コードをそのまま使う指定で、ターミナルのテーマの色に従う。
type Part = { text: string; color?: string; sgr?: string; href?: string }

// 幅はマス数で数える。東アジアの全角文字は2マス、それ以外は1コードポイント1マス。
const charCells = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe6f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)
    ? 2
    : 1
export const cells = (text: string) => [...text].reduce((n, c) => n + charCells(c.codePointAt(0)!), 0)
const partsWidth = (parts: Part[]) => parts.reduce((n, p) => n + cells(p.text), 0)

// 先頭から `max` マスに収め、切ったら末尾に … を付ける。
const cut = (text: string, max: number) => {
  if (cells(text) <= max) return text
  let out = ''
  for (const c of text) {
    if (cells(out) + charCells(c.codePointAt(0)!) > Math.max(1, max - 1)) break
    out += c
  }
  return `${out}…`
}

// 末尾側を残して `max` マスに収め、切ったら先頭に … を付ける。パス用。
const cutStart = (text: string, max: number) => {
  if (cells(text) <= max) return text
  const chars = [...text]
  let out = ''
  while (chars.length > 0 && cells(out) + charCells(chars[chars.length - 1]!.codePointAt(0)!) <= Math.max(5, max - 1)) {
    out = chars.pop()! + out
  }
  return `…${out}`
}

const shortenPath = (p: string, home: string, max: number) => {
  const q = home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p
  return cutStart(q, max)
}

// インジケータ。昔の statusline と同じく、ラベルに続けて6マスのバーと%を書く。色は
// 50%以上で黄、80%以上で赤、それ未満は指標ごとの色(ctx は cyan、5h は magenta、7d は
// blue、ac は yellow)。
type Indicator = { label: string; pct: number; accent: string }

const BAR_CELLS = 6

const levelSgr = (n: number, accent: string) => (n >= 80 ? '31' : n >= 50 ? '33' : accent)

const barOf = (n: number) => {
  const filled = Math.min(BAR_CELLS, Math.floor((n * BAR_CELLS) / 100))
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_CELLS - filled)}`
}

// バー付き(`ctx:[██░░░░] 12%`)と、狭いときの%だけ(`ctx:12%`)。
const indicatorParts = (ind: Indicator, form: 'bar' | 'pct'): Part[] => {
  const n = Math.round(ind.pct)
  return [
    { text: ind.label, color: ORANGE },
    { text: form === 'bar' ? `[${barOf(n)}] ${n}%` : `${n}%`, sgr: levelSgr(n, ind.accent) },
  ]
}

// 並びは、プランの上限(5h・7d)を先に、この会話の分(ctx・ac)を後にする。
export const indicatorsOf = (input: Input): Indicator[] => {
  const inds: Indicator[] = []
  const five = input.rate_limits?.five_hour?.used_percentage
  const seven = input.rate_limits?.seven_day?.used_percentage
  if (typeof five === 'number') inds.push({ label: '5h:', pct: five, accent: '35' })
  if (typeof seven === 'number') inds.push({ label: '7d:', pct: seven, accent: '34' })
  const size = input.context_window?.context_window_size
  const tokens = typeof size === 'number' && size > 0 ? ((input.context_window?.used_percentage ?? 0) / 100) * size : null
  // 最初の応答が来るまでは何も数えられていない。不明ではなく「空」として扱い、セッショ
  // ン開始直後から出す。
  if (tokens !== null) inds.push({ label: 'ctx:', pct: input.context_window?.used_percentage ?? 0, accent: '36' })
  // 自動コンパクトが始まる 95% を 100% とした使用量。
  if (tokens !== null && typeof size === 'number') inds.push({ label: 'ac:', pct: Math.min(100, (tokens / (size * 0.95)) * 100), accent: '33' })
  return inds
}

// インジケータを空白で区切って1列に並べた Part と、その幅。
const spaced = (inds: Indicator[], form: 'bar' | 'pct'): Part[] =>
  inds.flatMap((ind, i) => [...(i > 0 ? [{ text: ' ' }] : []), ...indicatorParts(ind, form)])

// 幅 `width` の行に詰める。1行に収まる最も広い表示(バー付き、%だけ)を選び、%だけで
// も入らないときは行を分ける。
export const fitIndicators = (inds: Indicator[], width: number): Part[][] => {
  for (const form of ['bar', 'pct'] as const) {
    const row = spaced(inds, form)
    if (partsWidth(row) <= width) return [row]
  }
  const rows: Part[][] = []
  let used = 0
  for (const ind of inds) {
    const item = indicatorParts(ind, 'pct')
    const w = partsWidth(item)
    if (rows.length === 0 || used + 1 + w > width) {
      rows.push(item)
      used = w
    } else {
      rows[rows.length - 1]!.push({ text: ' ' }, ...item)
      used += 1 + w
    }
  }
  return rows
}

// 作業場所の行。パス、ブランチとその状態、PR を、インジケータと同じくオレンジのラベルに値
// を続けて並べる。パスとブランチのラベルは Nerd Font のアイコン。色は 16 色の ANSI で、ターミナルのテーマに従う。
const dirGroup = (path: string): Part[] => [{ text: `${ICON.dir} `, color: ORANGE }, { text: path, sgr: '36' }]

// ブランチ名の後ろに、push 待ち(↑)、pull 待ち(↓)、未コミット(±)を、あるものだけ出す。
// すべてきれいなら ✓。
const gitGroup = (git: Git, name: string): Part[] => {
  const counts: Part[] = []
  if (git.ahead > 0) counts.push({ text: ` ↑${git.ahead}`, sgr: '32' })
  if (git.behind > 0) counts.push({ text: ` ↓${git.behind}`, sgr: '35' })
  if (git.changes > 0) counts.push({ text: ` ±${git.changes}`, sgr: '33' })
  return [
    { text: `${ICON.git} `, color: ORANGE },
    { text: name, sgr: git.changes > 0 ? '33' : '32' },
    ...(counts.length > 0 ? counts : [{ text: ' ✓', sgr: '32' }]),
  ]
}

// statusLine の stdin に PR のタイトルは無いので、番号を、レビュー状態の色で出す。
const PR_SGR: Record<string, string> = { approved: '32', changes_requested: '31', draft: '90' }
const prGroup = (pr: NonNullable<Input['pr']>): Part[] => [
  { text: 'pr:', color: ORANGE },
  { text: `#${pr.number}`, sgr: PR_SGR[pr.review_state ?? ''] ?? '35', href: pr.url },
]

// グループの間は空白2つ。
const GROUP_GAP = 2
const groupsWidth = (groups: Part[][]) => groups.reduce((n, g) => n + partsWidth(g), 0) + GROUP_GAP * Math.max(0, groups.length - 1)
const joinGroups = (groups: Part[][]): Part[] => groups.flatMap((g, i) => (i > 0 ? [{ text: ' '.repeat(GROUP_GAP) }, ...g] : g))

type Context = { width: number; home: string; git: Git | null }

// 幅に合わせた作業場所の行。12文字を超えるブランチ名から先に縮め、足りなければ PR を
// 外し、最後にパスを先頭側から切る。
const workplace = (input: Input, ctx: Context, width: number): Part[] => {
  const cwd = input.workspace?.current_dir ?? input.cwd ?? ''
  const git = ctx.git
  const pr = input.pr?.number ? input.pr : undefined
  const build = (path: string, branch: string | null, withPr: boolean): Part[][] => [
    dirGroup(path),
    ...(git && branch !== null ? [gitGroup(git, branch)] : []),
    ...(pr && withPr ? [prGroup(pr)] : []),
  ]
  const MIN_PATH = 14
  const bare = (branch: string | null, withPr: boolean) => groupsWidth(build('', branch, withPr))
  let branch = git?.branch ?? null
  if (branch !== null && width - bare(branch, true) - GROUP_GAP < MIN_PATH && cells(branch) > 12) {
    branch = cut(branch, Math.max(12, cells(branch) - (MIN_PATH - (width - bare(branch, true) - GROUP_GAP))))
  }
  const withPr = width - bare(branch, true) - GROUP_GAP >= 6
  const room = width - bare(branch, withPr) - GROUP_GAP
  const full = shortenPath(cwd, ctx.home, Infinity)
  const groups = build(shortenPath(cwd, ctx.home, Math.min(cells(full), Math.max(6, room))), branch, withPr)
  // ブランチ名の最小幅でも入らないほど狭いときは、パスだけにする。
  return joinGroups(groupsWidth(groups) <= width ? groups : build(shortenPath(cwd, ctx.home, Math.max(1, width - bare(null, false))), null, false))
}

// 1行を ANSI の文字列にする。OSC 8 のリンクは文字の外側に巻く。
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}
const paint = (p: Part) => {
  if (p.text === '') return ''
  const fg = p.sgr ? `\x1b[${p.sgr}m` : p.color ? rgb(p.color) : ''
  const styled = `${fg}${p.text}\x1b[0m`
  return p.href ? `\x1b]8;;${p.href}\x1b\\${styled}\x1b]8;;\x1b\\` : styled
}
const line = (parts: Part[]) => parts.map(paint).join('')

export const render = (input: Input, ctx: Context): string => {
  // 最後の1マスは空けておく。通知と行を共有するため、ぴったりだと折り返す。
  const width = Math.max(20, ctx.width - 1)
  const left = workplace(input, ctx, width)
  const inds = indicatorsOf(input)
  const rows: Part[][] = [left]
  // インジケータは作業場所の次の行に置く。間の空き行は、描画で潰されるので置かない。
  if (inds.length > 0) rows.push(...fitIndicators(inds, width))
  return rows.map(line).join('\n')
}

// 作業ツリーの状態を1回の git 呼び出しで取る。git の外や、時間内に終わらなかったとき
// は null。
export const readGit = (cwd: string): Git | null => {
  let out: string
  try {
    out = execFileSync('git', ['--no-optional-locks', '-C', cwd, '-c', 'core.fsmonitor=false', 'status', '--porcelain=v2', '--branch'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
  let head = ''
  let oid = ''
  let ahead = 0
  let behind = 0
  let changes = 0
  for (const l of out.split('\n')) {
    if (l === '') continue
    if (!l.startsWith('# ')) changes += 1
    else if (l.startsWith('# branch.head ')) head = l.slice('# branch.head '.length)
    else if (l.startsWith('# branch.oid ')) oid = l.slice('# branch.oid '.length)
    else if (l.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(l)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    }
  }
  const branch = head === '(detached)' ? oid.slice(0, 7) : head
  return branch === '' ? null : { branch, ahead, behind, changes }
}

const main = () => {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => (raw += chunk))
  process.stdin.on('end', () => {
    let input: Input
    try {
      input = JSON.parse(raw) as Input
    } catch {
      return
    }
    const cwd = input.workspace?.current_dir ?? input.cwd ?? process.cwd()
    const width = Number(process.env.COLUMNS) || 80
    process.stdout.write(`${render(input, { width, home: process.env.HOME ?? '', git: readGit(cwd) })}\n`)
  })
}

// ~/.claude/statusline.ts のようにシンボリックリンク越しに呼ばれても動くよう、実体のパスで比べる。
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
