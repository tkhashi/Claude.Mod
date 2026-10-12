import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Agent, Picker, Snap, View, Worktree } from '../types'

// エイリアスは常に各ファミリーの最新モデルを指すので、新しいモデルが出てもピ
// ッカーが追従する。/config のメニューにモデルの選択肢が無いときに使う。
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const empty: Snap = {
  model: '',
  effort: null,
  modelOptions: MODEL_ALIASES,
  ctxPercent: null,
  ctxTokens: null,
  ctxWindow: null,
  acPercent: null,
  limits: [],
  cwd: '',
  branch: null,
  dirty: false,
  changes: 0,
  ahead: 0,
  behind: 0,
  pr: null,
  worktrees: [],
  agents: [],
}

const snap = atom({ plugin: 'statusbar', key: 'snap' } as const, empty)
const view = atom({ plugin: 'statusbar', key: 'view' } as const, { drawer: null, compact: false } as View)
const picker = atom({ plugin: 'statusbar', key: 'picker' } as const, null as Picker)

const EFFORT_STORE_KEY = 'effort'
const COMPACT_STORE_KEY = 'compact'

// 帯は vim 風のステータスラインで、ベタ塗りのブロックを並べる。そのためテーマ
// の色ではなく、暗い画面向けの独自パレット(Catppuccin Mocha)を持つ。
const C = {
  ink: '#1e1e2e',
  text: '#cdd6f4',
  dim: '#7f849c',
  block: '#45475a',
  claude: '#d97757',
  red: '#f38ba8',
  peach: '#fab387',
  yellow: '#f9e2af',
  green: '#a6e3a1',
  teal: '#94e2d5',
  sky: '#89dceb',
  blue: '#89b4fa',
  lavender: '#b4befe',
  mauve: '#cba6f7',
  pink: '#f5c2e7',
}

// `b` から `a` へ `t` の割合だけ寄せた色。ゲージの塗りと下地は自分の色をイン
// ク側へ沈めたものにして、ゲージ全体が1つの色相に見えるようにする。
const mix = (a: string, b: string, t: number) => {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16)
  return `#${[0, 1, 2].map(i => Math.round(ch(a, i) * t + ch(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('')}`
}

// Powerline と Nerd Font のグリフ。
const I = {
  right: '',
  left: '',
  capL: '',
  capR: '',
  model: '✻',
  effort: '',
  ctx: '',
  session: '',
  weekly: '',
  compact: '',
  folder: '',
  branch: '',
  dirty: '',
  clean: '',
  tree: '\u{f0531}',
  robot: '',
  user: '\uf007',
  current: '',
  expand: '\uf065',
  compress: '\uf066',
}

const PATH_BG = '#585b70'

const effortColor: Record<string, string> = {
  max: C.red,
  xhigh: C.peach,
  high: C.yellow,
  medium: C.green,
  low: C.teal,
}

// effort 側の色とは重ならない色にしてある。隣り合う model と effort のブロッ
// クが同じ色にならないようにするため。
const familyColor: Record<string, string> = { opus: C.mauve, sonnet: C.blue, haiku: C.lavender, fable: C.pink }

const modelColor = (model: string) => {
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)?.[1]?.toLowerCase()
  return (family && familyColor[family]) || C.claude
}

const prStyle: Record<string, { icon: string; bg: string }> = {
  '': { icon: '', bg: C.mauve },
  draft: { icon: '', bg: C.dim },
  approved: { icon: '', bg: C.green },
  'changes!': { icon: '', bg: C.red },
}

const USER_BG = mix(C.sky, C.ink, 0.14)

const agentStatus: Record<string, { icon: string; color: string }> = {
  pending: { icon: '', color: C.dim },
  running: { icon: '', color: C.green },
  waiting: { icon: '', color: C.yellow },
  idle: { icon: '', color: C.dim },
  completed: { icon: '', color: C.sky },
  failed: { icon: '', color: C.red },
  killed: { icon: '', color: C.red },
}

const shortenPath = (p: string, home: string, max: number) => {
  const q = home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p
  if (q.length <= max) return q
  return `…${q.slice(q.length - Math.max(5, max - 1))}`
}

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)


const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// モデル ID を人が呼ぶ名前にする。"claude-opus-5-5[1m]" は "Opus 5.5 1M"、
// "claude-haiku-4-5-20251001" は "Haiku 4.5"、"claude-3-5-sonnet-20241022" は
// "Sonnet 3.5"。すでに短い名前や、形の分からないものはそのまま返す。
const prettyModel = (id: string, withCtx = true) => {
  const ctx = withCtx ? /\[(\d+[km])\]$/i.exec(id)?.[1]?.toUpperCase() : undefined
  const base = id.replace(/\[[^\]]*\]$/, '').replace(/^(?:[a-z]+\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '')
  const named = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(base)
  const legacy = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/i.exec(base)
  const [family, major, minor] = named ? [named[1], named[2], named[3]] : legacy ? [legacy[3], legacy[1], legacy[2]] : []
  const name = family && major
    ? `${titleCase(family)} ${major}${minor ? `.${minor}` : ''}`
    : /^[a-z]+$/.test(base)
      ? titleCase(base)
      : base
  return ctx ? `${name} ${ctx}` : name
}

// 最も短いモデル名。ファミリーの頭文字とバージョンで、"Sonnet 5.5" なら
// `S5.5`。
const shortModel = (id: string) => {
  const [family, ...rest] = prettyModel(id, false).split(' ')
  return `${(family ?? '').charAt(0)}${rest.join('')}`
}

// 選択肢が今動いているモデルを指しているか。"claude-opus-5-5" には "opus" が
// 当たり、"opus[1m]" は 1M コンテキストのときだけ当たる。
const isCurrentModel = (option: string, model: string) => {
  const o = option.toLowerCase()
  const m = model.toLowerCase()
  if (o === m) return true
  // エイリアスはファミリーを表し、`[1m]` が付けばコンテキストサイズも表す。両
  // 方が一致する必要がある。
  const ctx = (x: string) => /\[(\d+[km])\]$/.exec(x)?.[1] ?? ''
  const family = o.replace(/\[[^\]]*\]$/, '')
  return /^[a-z]+$/.test(family) && m.includes(family) && ctx(o) === ctx(m)
}

// スタイル付きの文字列ひと続き。セグメントはこれを横に並べたもので、押すとそ
// のアクションが走る。`bgHover` は文字色とは別に背景色を hover で変える。2つ
// のブロックが共有するグリフ用で、文字色は片方のブロック、背景色は隣のブロッ
// クに従う。
type Part = {
  text: string
  color?: string
  bg?: string
  bold?: boolean
  hover?: { scope: string; color: string }
  bgHover?: { scope: string; backgroundColor: string }
}
type Action =
  | { kind: 'drawer'; which: 'worktrees' | 'agents' }
  | { kind: 'compact' }
  | { kind: 'pick'; which: 'model' | 'effort' }
  | { kind: 'set'; which: 'model' | 'effort'; value: string }
  | { kind: 'close' }
  | { kind: 'link'; href: string }
// `square` のゲージは角丸にせず、前に1マスの空きを置いた素のバーにする。塗り
// が角丸の端ではなく、必ず1マス目から始まるようにするため。
type Seg = { key: string; parts: Part[]; action?: Action; square?: boolean }
// ステータスラインの1行。左端からのブロック、右端からのブロック、その間を埋め
// る余白から成る。
type Line = { left: Seg[]; right: Seg[] }

// 幅はマス数で数える。サロゲートペアのグリフも含めて1コードポイント1マス。
const cells = (text: string) => [...text].length
const segWidth = (seg: Seg) => seg.parts.reduce((n, p) => n + cells(p.text), 0)
const sumWidth = (segs: Seg[]) => segs.reduce((n, x) => n + segWidth(x), 0)

const block = (text: string, bg: string, color = C.ink, bold = true): Part => ({ text, bg, color, bold })
const firstPart = (seg: Seg) => seg.parts[0] ?? { text: '' }
const lastPart = (seg: Seg) => seg.parts[seg.parts.length - 1] ?? { text: '' }

// 押せるセグメントの Button はポインタの下で反転し、文字色が背景色になる。両
// 端のグリフは Button の外にあるので、同じ hover グループに入れてその色に追従
// させる。
const scopeOf = (seg: Seg) => (seg.action && seg.action.kind !== 'link' ? `sb-${seg.key}` : undefined)
const edge = (key: string, glyph: string, owner: Seg, part: Part, bg?: string): Seg => {
  const scope = scopeOf(owner)
  return {
    key,
    parts: [{ text: glyph, color: part.bg, bg, hover: scope ? { scope, color: part.color ?? C.ink } : undefined }],
  }
}
// 2つのブロックの間の角丸。文字色は `owner` の色、背景は `under` の色で、それ
// ぞれ自分のブロックの hover に従う。
const joint = (key: string, glyph: string, owner: Seg, ownerPart: Part, under: Seg | undefined, underPart: Part | undefined): Seg => {
  const scope = scopeOf(owner)
  const underScope = under ? scopeOf(under) : undefined
  return {
    key,
    parts: [
      {
        text: glyph,
        color: ownerPart.bg,
        bg: underPart?.bg,
        hover: scope ? { scope, color: ownerPart.color ?? C.ink } : undefined,
        bgHover: underScope && underPart ? { scope: underScope, backgroundColor: underPart.color ?? C.ink } : undefined,
      },
    ],
  }
}

// 幅に余裕がある間は、ブロックを隙間なく角丸でつなぐ。左端からは `| a )b )c
// )`、右端へは `( a( b( c |` の形で、帯の両端は平らにする。狭いときは四角いブ
// ロックを並べるだけにする。ゲージはどちらの場合も四角で、それぞれの前に1マス
// の空きを置く。
const gapSeg = (key: string): Seg => ({ key, parts: [{ text: ' ' }] })
const leftSide = (segs: Seg[], round: boolean) =>
  !round
    ? segs
    : segs.flatMap((seg, i) => {
        const next = segs[i + 1]
        const close = joint(`${seg.key})`, I.capR, seg, lastPart(seg), next, next && firstPart(next))
        return [seg, close]
      })
const rightSide = (segs: Seg[], round: boolean) =>
  !round
    ? segs.flatMap(seg => (seg.square ? [gapSeg(`_${seg.key}`), seg] : [seg]))
    : segs[0]?.square
      ? segs.flatMap(seg => [gapSeg(`_${seg.key}`), seg])
      : segs.flatMap((seg, i) => {
          const prev = segs[i - 1]
          const open = joint(`(${seg.key}`, I.capL, seg, firstPart(seg), prev, prev && lastPart(prev))
          return [open, seg]
        })
// 片側がブロック以外に使うマス数。ブロックごとの角丸1つずつ、またはゲージ間の
// 空き。
const sideEnds = (segs: Seg[], round: boolean) =>
  !round ? segs.filter(x => x.square).length : segs.length
const lineWidth = (line: Line, round: boolean) =>
  sumWidth(line.left) + sumWidth(line.right) + sideEnds(line.left, round) + sideEnds(line.right, round)

// ラベルと%を中に書いた塗りつぶしのプログレスバー。塗られたマスはゲージの色、
// 残りはその色を暗く沈めた色。`weight` はゲージ群の幅の中での取り分で、プラン
// の上限(5h・7d)を会話のコンテキストより多く取る。
type Gauge = { key: string; icon: string; label: string; short: string; pct: number; base: string; extra: string | null; weight: number }

const MAX_CELLS = 28

const barText = (label: string, value: string, width: number) =>
  ` ${label}${' '.repeat(Math.max(1, width - label.length - value.length - 2))}${value} `

const labelOf = (g: Gauge, level: Level) =>
  `${g.icon} ${level === 'short' ? g.short : level === 'extra' && g.extra ? `${g.label} ${g.extra}` : g.label}`

// ゲージの描き方。幅の広い順に、長いラベルと補足(リセット・トークン数)付きの
// バー、補足なし、短いラベル、アイコンと%だけ、%だけ(色で見分ける)。それぞれ
// 実際に表示する%の文字数で幅を測るので、入る限りラベルを残せる。
type Level = 'extra' | 'long' | 'short' | 'chip' | 'bare'

const chipText = (g: Gauge) => ` ${g.icon} ${Math.round(g.pct)}% `
const bareText = (g: Gauge) => ` ${Math.round(g.pct)}% `

const gaugeWidth = (g: Gauge, level: Level) =>
  level === 'chip'
    ? chipText(g).length
    : level === 'bare'
      ? bareText(g).length
      : barText(labelOf(g, level), `${Math.round(g.pct)}%`, 0).length

// ゲージは自分の色を保ち、使用量が高くなったら赤に変わる。
const gaugeColor = (g: Gauge) => (g.pct >= 80 ? C.red : g.base)

// 塗りの端に使う、左寄せの1/8マス刻みのブロック文字。
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']

// ゲージは下地の中に塗りを置いた形で、ラベルは両方の上にゲージ自身の色で書き、
// 塗りはラベルより薄くする。塗りの端が空白のマスに来たときは1/8マス単位、文字
// のマスなら1マス単位で止める。少しでも使っていれば必ず見える。
const gaugeSeg = (g: Gauge, width: number, level: Level): Seg => {
  const color = gaugeColor(g)
  const inner = level === 'chip' ? chipText(g) : level === 'bare' ? bareText(g) : barText(labelOf(g, level), `${Math.round(g.pct)}%`, width)
  const fillBg = mix(color, C.ink, 0.45)
  const trackBg = mix(color, C.ink, 0.18)
  const exact = Math.min(inner.length, Math.max(0, (g.pct * inner.length) / 100))
  let full = Math.floor(exact)
  let eighths = Math.round((exact - full) * 8)
  if (eighths === 8) {
    full += 1
    eighths = 0
  }
  if (g.pct > 0 && full === 0 && eighths === 0) eighths = 1
  const edgeChar = inner[full]
  let edge: Part | null = null
  if (eighths > 0 && edgeChar !== undefined) {
    if (edgeChar === ' ') edge = { text: EIGHTHS[eighths - 1]!, color: fillBg, bg: trackBg }
    else if (eighths >= 4 || full === 0) full += 1
  }
  const parts: Part[] = [block(inner.slice(0, full), fillBg, color)]
  if (edge) parts.push(edge)
  const restStart = full + (edge ? 1 : 0)
  if (restStart < inner.length) parts.push(block(inner.slice(restStart), trackBg, color))
  return { key: g.key, parts, square: true }
}

// 与えられた幅にゲージを並べる。幅を超えることはない。どれかを外す前に、まず
// 全部のゲージを%だけの最小表示で入れる(外すのは後ろからで、最小表示すら入ら
// ないときだけ)。残りの幅は weight で配り、取り分が最小幅に満たないゲージは最
// 小幅を取り、残りを他のゲージで分ける。そのうえで各ゲージは、自分の幅に収ま
// る一番広い表示段階を選ぶ。
export const fitGauges = (all: Gauge[], room: number): Seg[] => {
  for (let n = all.length; n > 0; n--) {
    const gauges = all.slice(0, n)
    // ゲージはそれぞれ前に空き1マスを伴う。
    const free = room - n
    const least = gauges.map(g => gaugeWidth(g, 'bare'))
    if (least.reduce((a, b) => a + b, 0) > free) continue
    const widths: (number | null)[] = gauges.map(() => null)
    for (;;) {
      const open = gauges.map((g, i) => (widths[i] === null ? i : -1)).filter(i => i >= 0)
      const left = free - widths.reduce<number>((a, w) => a + (w ?? 0), 0)
      const weight = open.reduce((a, i) => a + gauges[i]!.weight, 0)
      const under = open.filter(i => Math.floor((left * gauges[i]!.weight) / weight) < least[i]!)
      if (under.length === 0) {
        for (const i of open) widths[i] = Math.floor((left * gauges[i]!.weight) / weight)
        break
      }
      for (const i of under) widths[i] = least[i]!
    }
    return gauges.map((g, i) => {
      const w = Math.min(MAX_CELLS, widths[i]!)
      const level = (['extra', 'long', 'short', 'chip'] as const).find(l => gaugeWidth(g, l) <= w) ?? 'bare'
      return gaugeSeg(g, level === 'chip' || level === 'bare' ? 0 : w, level)
    })
  }
  return []
}

// セグメントを最大 `width` の行に詰める。入りきらないセグメントは次の行に回す。
const GAP = 1
const wrap = (segs: Seg[], width: number): Seg[][] => {
  const rows: Seg[][] = []
  let used = 0
  for (const seg of segs) {
    const w = segWidth(seg)
    const row = rows[rows.length - 1]
    if (!row || used + GAP + w > width) {
      rows.push([seg])
      used = w
    } else {
      row.push(seg)
      used += GAP + w
    }
  }
  return rows
}

// ゲージ群。プランの使用量(5h・7d)を先に、この会話の分(ctx・ac)を後に並べる。
const gaugesOf = (s: Snap): Gauge[] => {
  const gauges: Gauge[] = []
  for (const kind of ['five_hour', 'seven_day']) {
    const l = s.limits.find(x => x.kind === kind)
    if (!l) continue
    if (kind === 'five_hour') gauges.push({ key: '5h', icon: I.session, label: '5h', short: '5h', pct: l.percent, base: C.green, extra: null, weight: 3 })
    else gauges.push({ key: '7d', icon: I.weekly, label: '7d', short: '7d', pct: l.percent, base: C.blue, extra: null, weight: 3 })
  }
  if (s.ctxPercent !== null) {
    const extra = s.ctxTokens !== null && s.ctxWindow !== null ? `${kTokens(s.ctxTokens)}/${kTokens(s.ctxWindow)}` : null
    gauges.push({ key: 'ctx', icon: I.ctx, label: 'Ctx', short: 'Ctx', pct: s.ctxPercent, base: C.peach, extra, weight: 1 })
  }
  if (s.acPercent !== null) gauges.push({ key: 'ac', icon: I.compact, label: 'Auto-compact', short: 'AC', pct: s.acPercent, base: C.pink, extra: null, weight: 1 })
  return gauges
}

let prTick = 0

// 帯を最初の状態に戻す。一覧もピッカーも閉じる。
async function resetView($: any) {
  await update($, view, v => ({ ...v, drawer: null }))
  await update($, picker, () => null)
}

// 何か開いているときだけ書き込む resetView。
async function closeAll($: any) {
  if ((await read($, view)).drawer !== null || (await read($, picker)) !== null) await resetView($)
}

// 今の effort。次のセッション用に保存しておき、そのセッションの最初のターンで
// 値が届く前から帯に出せるようにする。
async function setEffort($: any, effort: string | null) {
  await update($, snap, (s: Snap) => ({ ...s, effort }))
  if (effort !== null) await $.store.set(EFFORT_STORE_KEY, effort)
}

// /effort の実行で設定された effort。引数か、コマンドのメニューから選んだ場合
// は出力に書かれたレベル。
const effortOfRun = (args: string, text: string | undefined) => {
  const arg = args.trim().toLowerCase()
  if (EFFORTS.includes(arg)) return arg
  const said = /effort level to (\w+)/i.exec(text ?? '')?.[1]?.toLowerCase()
  return said && EFFORTS.includes(said) ? said : null
}

// コマンドを打つのと同じ方法で model や effort を切り替える。帯にはすぐ反映し、
// 次のターンで確定する。
async function apply($: any, which: 'model' | 'effort', value: string) {
  await update($, picker, () => null)
  // コマンドはターンが終わるまで待たされる。帯には選んだ値をすぐ出し、コマン
  // ドが失敗したら元に戻す。
  const before = await read($, snap)
  if (which === 'effort') await setEffort($, value)
  else await update($, snap, (s: Snap) => ({ ...s, model: value }))
  try {
    await $.command.run({ command: which, args: value })
    refresh($).catch(() => undefined)
  } catch (err) {
    await update($, snap, (s: Snap) => ({ ...s, model: before.model, effort: before.effort }))
    $.ui.toast(`Could not switch ${which}: ${String(err)}`)
  }
}

async function loadModelOptions($: any) {
  try {
    const row = (await $.config.list()).find((r: any) => r.key === 'model')
    const options = (row?.options ?? []).filter((o: string) => o && o.toLowerCase() !== 'default')
    if (options.length > 0) await update($, snap, (s: Snap) => ({ ...s, modelOptions: options }))
  } catch {
    // エイリアスのままにする。
  }
}

// プロジェクト内(そのプロジェクトの .claude/worktrees か .claude/worktree の
// 下)に置かれた worktree を、`git worktree list` の情報から拾う。
const PROJECT_WORKTREE = /^\/\.claude\/worktrees?\//

// refresh は同時に1つだけ。実行中に頼まれた分は終わった後に1回だけ走らせる。
// 遅い実行が新しい結果を上書きしないようにするため。
let refreshing: Promise<void> | null = null
let refreshAgain = false

async function refresh($: any): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return refreshing
  }
  refreshing = (async () => {
    try {
      do {
        refreshAgain = false
        await refreshOnce($)
      } while (refreshAgain)
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function refreshOnce($: any) {
  const cwd = await $.session.cwd()
  const git = async (args: string[]) => {
    try {
      const r = await $.process.run(['git', '--no-optional-locks', '-C', cwd, '-c', 'core.fsmonitor=false', ...args], { timeoutMs: 4000 })
      return r.exitCode === 0 ? (r.stdout as string).trim() : null
    } catch {
      return null
    }
  }
  const branch = (await git(['symbolic-ref', '--short', 'HEAD'])) ?? (await git(['rev-parse', '--short', 'HEAD']))
  const status = branch !== null ? await git(['status', '--porcelain']) : null
  const changes = status ? status.split('\n').filter(l => l !== '').length : 0
  const dirty = changes > 0
  // upstream があるとき、push 待ちと pull 待ちのコミット数。
  const counts = branch !== null ? await git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']) : null
  const [behind, ahead] = (counts ?? '0 0').split(/\s+/).map(n => Number(n) || 0)

  const worktrees: Worktree[] = []
  if (branch !== null) {
    const top = await git(['rev-parse', '--show-toplevel'])
    // セッションがどの worktree で動いていても、メインのチェックアウトを基準
    // にする。
    const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const main = common ? common.replace(/\/\.git\/?$/, '') : top
    for (const chunk of ((await git(['worktree', 'list', '--porcelain'])) ?? '').split('\n\n')) {
      const path = /^worktree (.+)$/m.exec(chunk)?.[1]
      if (!path || !main || !path.startsWith(`${main}/`) || !PROJECT_WORKTREE.test(path.slice(main.length))) continue
      const ref = /^branch refs\/heads\/(.+)$/m.exec(chunk)?.[1] ?? null
      worktrees.push({ path, branch: ref, current: path === top })
    }
  }

  let agents: Agent[] = []
  try {
    agents = (await $.agent.list()).map((a: any) => ({ id: a.id, description: a.name ?? a.description, type: a.type, status: a.status }))
  } catch {
    agents = []
  }

  // PR は1分に1回取り直す。ブランチが変わったときは古い PR を消してすぐ取り直
  // す。取得の失敗(ネットワーク・認証)では表示中の PR を残し、gh が「PR が無
  // い」と答えたときだけ消す。
  let prPatch = {}
  const branchChanged = branch !== (await read($, snap)).branch
  if (branchChanged) prPatch = { pr: null }
  if (prTick++ % 12 === 0 || branchChanged) {
    try {
      const r = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,reviewDecision,isDraft,url'], { cwd, timeoutMs: 8000 })
      if (r.exitCode === 0) {
        const j = JSON.parse(r.stdout)
        const state = j.isDraft ? 'draft' : j.reviewDecision === 'APPROVED' ? 'approved' : j.reviewDecision === 'CHANGES_REQUESTED' ? 'changes!' : ''
        prPatch = { pr: { number: j.number, title: j.title, state, url: j.url } }
      } else if (/no pull requests? found/i.test(r.stderr ?? '')) {
        prPatch = { pr: null }
      }
    } catch {
      // 表示中の PR を残す。
    }
  }

  const usage = await $.session.usage()
  const c = usage.context
  // 最初の応答が来るまでは何も数えられていない。不明ではなく「空」として扱い、
  // セッション開始直後からゲージを出す。
  const tokens = c.window > 0 ? (c.tokens ?? 0) : undefined
  const ac = tokens !== undefined ? Math.min(100, (tokens / (c.window * 0.95)) * 100) : null
  const model = await $.session.model()
  await update($, snap, (s: Snap) => ({
    ...s,
    ...prPatch,
    model,
    cwd,
    branch,
    dirty,
    changes,
    ahead: ahead ?? 0,
    behind: behind ?? 0,
    worktrees,
    agents,
    ctxPercent: c.percent ?? (tokens !== undefined ? Math.round((tokens / c.window) * 100) : null),
    ctxTokens: tokens ?? null,
    ctxWindow: c.window > 0 ? c.window : null,
    acPercent: ac,
    limits: usage.rateLimits.map((l: any) => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt ?? null })),
  }))
}

let home = ''
let timer: { cancel: () => void } | null = null

// 帯で描ける effort レベル。それ以外(数値のバジェット、古い版で保存された値)
// は null。
const effortOf = (x: unknown) => (typeof x === 'string' && EFFORTS.includes(x) ? x : null)

// 描画が何も表示しないか。中のどこにも文字が無いか。
const isBlank = (el: any): boolean => {
  if (el === null || el === undefined || el === false) return true
  if (typeof el === 'string') return el.trim() === ''
  const children = el.props?.children ?? el.children
  if (el.type === 'Button') return false
  if (children === undefined) return true
  return (Array.isArray(children) ? children : [children]).every(isBlank)
}

// 帯の id。ピッカーを矢印キーで動かすためのフォーカスリングがここにある。
let aboveId: string | null = null

// 帯を描く。開いている一覧があればステータス行の上に出す。モデルが分かる前は
// null を返して何も描かない。
async function drawBand($: any, e: any) {
    const s = await read($, snap)
    if (s.model === '') return null
    const v = await read($, view)
    const open = await read($, picker)
    const { Box, Text, Button, Link } = $.ui.resolve(e)

    // 最後のブロックが折り返さないよう1マス空けておく。幅に余裕のある帯は左に
    // も余白を取る。
    const MARGIN = 1
    const fullWidth = Math.max(20, e.props.bodyColumns - 1)
    const effortBg = s.effort ? (effortColor[s.effort] ?? C.claude) : C.block

    // 1行目は vim のモード表示のように、model、effort、右側に worktree・エー
    // ジェントのボタンを並べる。どの幅でも1行に収める。model 名はコンテキスト
    // サイズ付き、名前だけ、幅が足りなくなったら頭文字とバージョン、の順に縮
    // める。
    const modelSeg = (form: 'ctx' | 'name' | 'short', withIcon: boolean): Seg => ({
      key: 'model',
      parts: [
        block(
          ` ${withIcon ? `${I.model} ` : ''}${form === 'short' ? shortModel(s.model) : prettyModel(s.model, form === 'ctx')} `,
          modelColor(s.model),
        ),
      ],
      action: { kind: 'pick', which: 'model' },
    })
    // 1色のひと続きにして、Button が丸ごと反転するようにする。ヒント行に入り
    // きらなかった 5h・7d は effort の横に%だけで出し、プランの使用量が常に見
    // えるようにする。
    const spare: Seg[] = gaugesOf(s)
      .filter(g => hintMissing.includes(g.key))
      .map(g => ({ key: `spare-${g.key}`, parts: [block(bareText(g), gaugeColor(g))] }))
    const effortSeg = (withIcon: boolean): Seg => ({
      key: 'effort',
      parts: [block(` ${withIcon ? `${I.effort} ` : ''}${s.effort ?? 'effort'} `, effortBg, s.effort ? C.ink : C.text)],
      action: { kind: 'pick', which: 'effort' },
    })


    // ピッカー。開いている間は1行目の下に出す。帯の中で唯一折り返す部分。
    const pickerRows: Seg[][] = []
    if (open) {
      const options = open === 'model' ? s.modelOptions : EFFORTS
      const picks: Seg[] = [{ key: 'pick-h', parts: [{ text: open === 'model' ? `${I.model} Model` : `${I.effort} Effort`, color: C.text, bold: true }] }]
      for (const o of options) {
        const current = open === 'model' ? isCurrentModel(o, s.model) : o === s.effort
        const tint = open === 'model' ? modelColor(o) : (effortColor[o] ?? C.claude)
        picks.push({
          key: `pick-${o}`,
          parts: [block(` ${current ? '✓ ' : ''}${open === 'model' ? prettyModel(o) : titleCase(o)} `, current ? tint : C.block, current ? C.ink : tint)],
          action: { kind: 'set', which: open, value: o },
        })
      }
      picks.push({ key: 'pick-x', parts: [block(' ✕ ', C.block, C.text)], action: { kind: 'close' } })
      pickerRows.push(...wrap(picks, fullWidth))
    }

    // 2行目はセッションの作業場所。パス、ブランチとその状態、PR を並べる。
    const running = s.agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').length
    const wtSeg: Seg = {
      key: 'wt',
      parts: [block(` ${I.tree} `, C.teal)],
      action: { kind: 'drawer', which: 'worktrees' },
    }
    const agSeg: Seg = {
      key: 'ag',
      // エージェントが動いている間は緑。件数は一覧の中で見る。
      parts: [block(` ${I.robot} `, running > 0 ? C.green : C.lavender)],
      action: { kind: 'drawer', which: 'agents' },
    }
    // 帯の全体表示と1行表示を切り替える。
    const compactSeg: Seg = {
      key: 'compact',
      parts: [block(` ${v.compact ? I.expand : I.compress} `, C.block, C.text)],
      action: { kind: 'compact' },
    }
    // パスは無彩色のグレーにする。色相はすべて、すぐ上に並ぶ model と effort
    // が使っているため。
    const pathSeg = (path: string): Seg => ({ key: 'cwd', parts: [block(` ${I.folder} ${path} `, PATH_BG, C.text)] })
    // ブランチ名の後ろに、push 待ち(↑)、pull 待ち(↓)、未コミット(±)を、あるも
    // のだけ出す。すべてきれいなら ✓。
    const branchSeg = (name: string): Seg => {
      const tint = s.dirty ? C.yellow : C.green
      const counts: Part[] = []
      if (s.ahead > 0) counts.push(block(` ↑${s.ahead}`, C.block, C.green))
      if (s.behind > 0) counts.push(block(` ↓${s.behind}`, C.block, C.peach))
      if (s.changes > 0) counts.push(block(` ±${s.changes}`, C.block, C.yellow))
      return {
        key: 'br',
        parts: [
          block(` ${I.branch} `, C.block, C.text),
          block(name, C.block, tint),
          ...(counts.length > 0 ? counts : [block(` ${I.clean}`, C.block, C.green)]),
          block(' ', C.block, C.text),
        ],
      }
    }
    const prSeg = (title: string | null): Seg => {
      if (!s.pr) return { key: 'pr', parts: [block(` ${prStyle['']!.icon} `, C.block, C.dim, false)] }
      const st = prStyle[s.pr.state] ?? prStyle['']!
      const parts = [block(` ${st.icon} #${s.pr.number} `, st.bg)]
      if (title) parts.push(block(`${title} `, st.bg, C.ink, false))
      return { key: 'pr', parts, action: { kind: 'link', href: s.pr.url } }
    }
    const left2 = (path: string, branch: string | null, title: string | null, withPr = true): Seg[] => [
      pathSeg(path),
      ...(branch === null ? [] : [branchSeg(branch)]),
      ...(withPr ? [prSeg(title)] : []),
    ]
    // 描ける最大の帯。全部がそのまま収まる間は広い表示(余白と角丸あり)、そう
    // でなければ狭い表示(四角、余白なし)にする。
    const layout = (round: boolean) => {
      const width = round ? fullWidth - MARGIN : fullWidth
      // 左側は、model のコンテキストサイズ、名前の頭文字化、アイコンの順に手
      // 放す。
      let line1: Line = { left: [], right: [] }
      let full = false
      // 一番狭いときはドロワーのボタンも外す。コンパクト切替は右端に残す。
      const tries1 = [
        ['ctx', true, true],
        ['name', true, true],
        ['short', true, true],
        ['short', false, true],
        ['short', false, false],
      ] as const
      for (const [form, withIcon, drawers] of tries1) {
        line1 = { left: [modelSeg(form, withIcon), effortSeg(withIcon), ...spare], right: drawers ? [wtSeg, agSeg, compactSeg] : [compactSeg] }
        if (lineWidth(line1, round) + 1 <= width) {
          full = form === 'ctx'
          break
        }
      }
      // 2行目では、12文字を超えるブランチ名から先に縮め、次に PR タイトル、最
      // 後にパスを先頭側から切る。
      const MIN_PATH = 14
      const bare = (branch: string | null) => lineWidth({ left: left2('', branch, null), right: [] }, round)
      let branch = s.branch
      if (width - bare(branch) - 1 < MIN_PATH && branch !== null && branch.length > 12) {
        branch = cut(branch, Math.max(12, branch.length - (MIN_PATH - (width - bare(branch) - 1))))
      }
      // パスに6マスも取れないほど狭いときは、PR を外す。
      const withPr = width - bare(branch) - 1 >= 6
      const room = width - lineWidth({ left: left2('', branch, null, withPr), right: [] }, round) - 1
      const fullPath = shortenPath(s.cwd, home, Infinity)
      const pathLen = Math.min(fullPath.length, Math.max(6, room))
      const titleRoom = room - pathLen - 1
      const title = s.pr && titleRoom >= 6 ? cut(s.pr.title, titleRoom) : null
      const line2: Line = { left: left2(shortenPath(s.cwd, home, pathLen), branch, title, withPr), right: [] }
      const fits = full && pathLen === fullPath.length
      return { round, width, line1, line2, fits }
    }
    // コンパクト表示。全部を1行に四角いブロックで並べ、元に戻す切替は全体表示
    // と同じく右端に固定する。幅が足りなくなるにつれて、model を頭文字に、ア
    // イコンとブランチ名の長さ、PR、ブランチ、ドロワーのボタン、最後にパスの
    // 順に削り、切替が常に見えるようにする。
    const single = (): Line => {
      const MIN_PATH = 6
      const tries = [
        { form: 'name', icon: true, branch: 12, pr: true, drawers: true },
        { form: 'short', icon: true, branch: 12, pr: true, drawers: true },
        { form: 'short', icon: false, branch: 8, pr: true, drawers: true },
        { form: 'short', icon: false, branch: 8, pr: false, drawers: true },
        { form: 'short', icon: false, branch: 0, pr: false, drawers: true },
        { form: 'short', icon: false, branch: 0, pr: false, drawers: false },
        { form: 'short', icon: false, branch: 0, pr: false, drawers: false, path: false },
      ] as const
      const build = (t: (typeof tries)[number], path: string): Line => ({
        left: [
          modelSeg(t.form, t.icon),
          effortSeg(t.icon),
          ...spare,
          ...('path' in t ? [] : [pathSeg(path)]),
          ...(s.branch !== null && t.branch > 0 ? [branchSeg(cut(s.branch, t.branch))] : []),
          ...(t.pr ? [prSeg(null)] : []),
        ],
        right: t.drawers ? [wtSeg, agSeg, compactSeg] : [compactSeg],
      })
      const t = tries.find(x => lineWidth(build(x, ''), false) + ('path' in x ? 0 : MIN_PATH) + 1 <= fullWidth) ?? tries[tries.length - 1]!
      const room = fullWidth - lineWidth(build(t, ''), false) - 1
      return build(t, shortenPath(s.cwd, home, Math.max(MIN_PATH, room)))
    }
    const roomy = layout(true)
    const { round, width, line1, line2 } = v.compact
      ? { round: false, width: fullWidth, line1: single(), line2: null }
      : roomy.fits
        ? roomy
        : layout(false)

    const press = (a: Action) => async () => {
      // 一覧は同時に1つだけ開く。1つ開くと、ほかに開いていたものは閉じる。
      if (a.kind === 'drawer') {
        await update($, picker, () => null)
        return update($, view, x => ({ ...x, drawer: x.drawer === a.which ? null : a.which }))
      }
      if (a.kind === 'pick') {
        await update($, view, x => ({ ...x, drawer: null }))
        const opening = (await read($, picker)) !== a.which
        await update($, picker, () => (opening ? a.which : null))
        // フォーカスリングは今の選択肢から始める。矢印キーでそこから動かし、
        // Enter で決定する。押した時点で帯がキー入力を受け取っている。
        if (opening) {
          const options = a.which === 'model' ? s.modelOptions : EFFORTS
          const current = options.find(o => (a.which === 'model' ? isCurrentModel(o, s.model) : o === s.effort)) ?? options[0]
          if (current && aboveId) $.ui.focus({ requestId: aboveId, key: `pick-${current}` }).catch(() => undefined)
        }
        return
      }
      if (a.kind === 'compact') {
        // この描画が見た値ではなく、今の view から反転させる。素早く連打して
        // もそれぞれ切り替わるようにするため。
        const compact = !(await read($, view)).compact
        await update($, view, x => ({ ...x, compact }))
        return $.store.set(COMPACT_STORE_KEY, compact)
      }
      if (a.kind === 'close') return update($, picker, () => null)
      if (a.kind === 'set') return apply($, a.which, a.value)
    }

    const texts = (key: string, parts: Part[]) =>
      parts.filter(p => p.text !== '').map((p, j) =>
        // ブロックの端は Button の hover に追従するが、自分から点灯させてはい
        // けない。Text の中に入れた Text はグループに追従するだけで点灯させな
        // いので、端だけにポインタを乗せても何も変わらない(Button の縁に乗っ
        // たときと同じ)。
        p.bgHover ? (
          <Text key={`${key}${j}`}>
            <Text color={p.color} hover={p.hover}>
              <Text backgroundColor={p.bg} hover={p.bgHover}>
                {p.text}
              </Text>
            </Text>
          </Text>
        ) : p.hover ? (
          <Text key={`${key}${j}`}>
            <Text color={p.color} backgroundColor={p.bg} hover={p.hover}>
              {p.text}
            </Text>
          </Text>
        ) : (
          <Text key={`${key}${j}`} color={p.color} backgroundColor={p.bg} bold={p.bold} hover={p.hover} wrap="truncate-end">
            {p.text}
          </Text>
        ),
      )

    const draw = (seg: Seg) => {
      const a = seg.action
      if (!a) return texts(seg.key, seg.parts)
      if (a.kind === 'link') return <Link href={a.href}>{texts(seg.key, seg.parts)}</Link>
      const scope = scopeOf(seg)
      return (
        <Button key={seg.key} plain hover={scope ? { scope } : undefined} onPress={press(a)}>
          {texts(seg.key, seg.parts)}
        </Button>
      )
    }
    const segBox = (seg: Seg) => (
      <Box key={seg.key} flexShrink={0}>
        {draw(seg)}
      </Box>
    )

    const statusline = (line: Line, i: number) => (
      <Box key={`r${i}`} overflow="hidden">
        {leftSide(line.left, round).map(segBox)}
        <Box key="fill" flexGrow={1}>
          <Text key="fill-t"> </Text>
        </Box>
        {rightSide(line.right, round).map(segBox)}
      </Box>
    )

    // ドロワー。worktree とサブエージェントを、それぞれのボタンで1行ずつ一覧
    // 表示する。どの行を押してもドロワーは閉じる(他の場所をクリックしたときと
    // 同じ)。
    const row = (key: string, parts: Part[]) => (
      <Box key={key}>
        <Button key={`${key}-b`} plain onPress={() => resetView($)}>
          {texts(key, parts)}
        </Button>
      </Box>
    )
    const heading = (key: string, icon: string, color: string, title: string, n: number) =>
      row(key, [
        { text: ` ${icon} `, color, bold: true },
        { text: title, color: C.text, bold: true },
        { text: ` ${n}`, color: C.dim },
      ])
    const worktreeRows = v.drawer === 'worktrees'
      ? [
          heading('wt-h', I.tree, C.teal, 'Worktrees', s.worktrees.length),
          ...(s.worktrees.length === 0
            ? [row('wt-none', [{ text: '    None under .claude/worktrees', color: C.dim }])]
            : s.worktrees.map((w, i) =>
                row(`wt${i}`, [
                  { text: w.current ? `   ${I.current} ` : '     ', color: C.green, bold: true },
                  { text: `${I.branch} `, color: C.dim },
                  { text: (w.branch ?? '(detached)').padEnd(24), color: w.current ? C.green : C.text, bold: w.current },
                  { text: shortenPath(w.path, home, Math.max(12, width - 34)), color: C.blue },
                ]),
              )),
        ]
      : []
    const agentRows = v.drawer === 'agents'
      ? [
          heading('ag-h', I.robot, C.lavender, 'Subagents', s.agents.length),
          ...(s.agents.length === 0
            ? [row('ag-none', [{ text: '    None in this session', color: C.dim }])]
            : s.agents.map((a, i) => {
                const st = agentStatus[a.status] ?? { icon: '?', color: C.text }
                return row(`ag${i}`, [
                  { text: `   ${st.icon} `, color: st.color, bold: true },
                  { text: a.type.padEnd(18), color: C.text, bold: true },
                  { text: a.description, color: C.dim },
                ])
              })),
        ]
      : []

    // 開いている一覧は帯の上に、1行空けて出す。ステータス行の位置が動かないよ
    // うにするため。
    const lists = [
      ...pickerRows.map((row, i) => (
        <Box key={`p${i}`} columnGap={GAP}>
          {row.map(segBox)}
        </Box>
      )),
      ...worktreeRows,
      ...agentRows,
    ]
    return (
      <Box flexDirection="column" marginLeft={round ? MARGIN : 0} marginTop={round ? 1 : 0}>
        {lists.length > 0 ? (
          <Box key="lists" flexDirection="column" marginBottom={1}>
            {lists}
          </Box>
        ) : null}
        {statusline(line1, 0)}
        {line2 ? statusline(line2, 1) : null}
      </Box>
    )
}

// プロンプト下のヒント行に描くゲージ。本体はモード表示(`⏵⏵ auto mode on`)をフ
// ックの描画の左に残すので、その右にヒント文の残り、さらにゲージを並べる。ヒ
// ント行に入りきらなかったプランのゲージ(最後に描いたときのもの)は、プロンプ
// ト上の帯が代わりに出し、見えなくならないようにする。
let hintMissing: string[] = []

async function drawHint($: any, e: any) {
  const s = await read($, snap)
  if (s.model === '') return null
  const gauges = gaugesOf(s)
  if (gauges.length === 0) {
    hintMissing = []
    return null
  }
  const { Box, Text } = $.ui.resolve(e)
  const hint: string = e.props.hint ?? ''
  // ヒント行の先頭2マス、モード表示中はその分(このときヒント文は `(shift+tab
  // to cycle)` を含む)、それと1マスの余裕を差し引く。
  const pill = /shift\+tab to cycle/.test(hint) ? 18 : 0
  const width = Math.max(20, (e.viewport?.columns ?? 100) - 2 - pill - 1)
  // ゲージは行の半分まで使い、ヒント文は残りに入れて末尾を切る。それでゲージ
  // が1本でも落ちる場合は、ヒント文を消してゲージに行全体を使わせる。5h と 7d
  // は最後まで残し、それでも入らない分はプロンプト上の帯が代わりに出す。
  const roomy = fitGauges(gauges, Math.min(Math.floor(width / 2), width - Math.min(hint.length, 12) - 1))
  const all = roomy.length === gauges.length
  const segs = all ? roomy : fitGauges(gauges, width)
  hintMissing = ['5h', '7d'].filter(k => gauges.some(g => g.key === k) && !segs.some(x => x.key === k))
  const parts = segs.flatMap(seg => [gapSeg(`_${seg.key}`), seg]).flatMap(seg => seg.parts.map((p, j) => ({ ...p, key: `${seg.key}${j}` })))
  return (
    <Box overflow="hidden">
      <Box key="hint" flexShrink={1} flexGrow={1}>
        <Text dimColor wrap="truncate-end">
          {all ? hint : ' '}
        </Text>
      </Box>
      <Box key="gauges" flexShrink={0}>
        {parts.map(p => (
          <Text key={p.key} color={p.color} backgroundColor={p.bg} bold={p.bold}>
            {p.text}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    // 各処理を独立させる。どれかが失敗しても(HOME が無い、ストアが読めない)タ
    // イマーは必ず起動させる。
    try {
      home = (await $.process.run(['sh', '-c', 'printf %s "$HOME"'])).stdout
    } catch {
      home = ''
    }
    try {
      if ((await $.store.get(COMPACT_STORE_KEY)) === true) await update($, view, v => ({ ...v, compact: true }))
      const effort = effortOf((await $.store.get(EFFORT_STORE_KEY)) as unknown)
      if (effort) await update($, snap, (s: Snap) => (s.effort === null ? { ...s, effort } : s))
    } catch {
      // 既定の状態から始める。
    }
    void loadModelOptions($)
    // 再読み込みや再有効化でセッション開始が再び走る。古いタイマーは止める。
    timer?.cancel()
    timer = $.clock.every(5000, () => void refresh($).catch(() => undefined))
    void refresh($).catch(() => undefined)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    void refresh($).catch(() => undefined)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // サブエージェントのステップは、セッションではなくそのエージェント自身の
    // model と effort を表す。
    if (!e.agentId) {
      await update($, snap, (s: Snap) => ({ ...s, model: e.model }))
      // 帯で扱えるレベルだけ採る。effort の無いモデル(値が送られない)や数値の
      // バジェットのときは、古い値を残さず effort なしにする。
      await update($, snap, (s: Snap) => ({ ...s, effort: effortOf(e.effort) }))
      const effort = effortOf(e.effort)
      if (effort) await $.store.set(EFFORT_STORE_KEY, effort)
    }
    return yield* next(e)
  })

  // /effort は、打った場合もメニューから選んだ場合も、すぐ帯に反映する。
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    if (e.command === 'effort') {
      const effort = effortOfRun(e.args, r.text)
      if (effort) await setEffort($, effort)
    }
    return r
  })

  // シェルの別の場所をクリックしても、プラグインに届くイベントは無い。プロン
  // プトへの入力や送信を「別の操作に移った」合図とみなす。
  on('prompt.edit', async ($, e, next) => {
    await closeAll($)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await closeAll($)
    return next(e)
  })

  // 帯はポインタで操作する。フォーカスリングはピッカー専用。
  on('ui.focus', async ($, e, next) => {
    if (e.component !== 'AbovePrompt') return next(e)
    // 帯のボタン以外の部分をクリックしたら、最初の状態に戻す。
    if (!e.element || e.plugin !== 'statusbar') await resetView($)
    // 矢印キー用にフォーカスリングを受け取るのはピッカーの選択肢だけ。それ以
    // 外で受け取ると、クリックの後にブロックが反転したまま残ってしまう。
    if (e.plugin === 'statusbar' && !e.element?.startsWith('pick-')) return { deny: 'statusbar takes no focus' }
    return next(e)
  })

  // 発言者を左の縦線で示す。Claude の返答は Claude の色、ユーザーのプロンプト
  // はその色に加えて薄い背景も付ける。Claude 側に暖色の背景を敷くと警告に見え
  // たので、背景は付けない。
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="gutter" borderStyle="quote" borderColor={C.sky} backgroundColor={USER_BG} paddingLeft={1}>
        <Text>{e.props.text}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const { Box, Markdown } = $.ui.resolve(e)
    return (
      <Box key="gutter" borderStyle="quote" borderColor={C.claude} paddingLeft={1}>
        <Markdown text={e.props.text} />
      </Box>
    )
  })

  // 帯は下位のフックの描画(ファイルピッカーなど他の mod の一覧)の下に置き、互
  // いに隠さないようにする。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    aboveId = e.requestId
    const band = await drawBand($, e)
    if (!band) return next(e)
    const rest = await next(e)
    if (isBlank(rest)) return band
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rest}
        {band}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => (await drawHint($, e)) ?? next(e))
}
