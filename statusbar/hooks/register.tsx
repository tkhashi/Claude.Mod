import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Agent, Picker, Snap, View, Worktree } from '../types'

// Aliases always name the newest model of each family, so the picker keeps up
// with new releases; used when the /config menu lists no model options.
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

// The band is a vim-style statusline of solid blocks, so it brings its own
// palette (Catppuccin Mocha) rather than the theme's, made for a dark screen.
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

// A color `t` of the way from `b` to `a`: a gauge's fill and track are its
// own color sunk toward the ink, so the whole gauge reads as one hue.
const mix = (a: string, b: string, t: number) => {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16)
  return `#${[0, 1, 2].map(i => Math.round(ch(a, i) * t + ch(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('')}`
}

// Powerline and Nerd Font glyphs.
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

// Kept apart from the efforts' colors, so the model and effort blocks beside
// each other never share one.
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
  const q = home && p.startsWith(home) ? `~${p.slice(home.length)}` : p
  if (q.length <= max) return q
  return `…${q.slice(q.length - Math.max(5, max - 1))}`
}

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)


const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A model id as people say it: "claude-opus-5-5[1m]" is "Opus 5.5 1M",
// "claude-haiku-4-5-20251001" "Haiku 4.5", "claude-3-5-sonnet-20241022"
// "Sonnet 3.5"; a name already short, or one of no known shape, as it is.
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

// The model at its shortest: the family's initial and the version, `S5.5`
// for "Sonnet 5.5".
const shortModel = (id: string) => {
  const [family, ...rest] = prettyModel(id, false).split(' ')
  return `${(family ?? '').charAt(0)}${rest.join('')}`
}

// Whether the option names the model running now: "opus" for "Opus 5.5".
const isCurrentModel = (option: string, model: string) => model.toLowerCase().includes(option.toLowerCase())

// One run of styled text; a segment is a few runs drawn side by side, and
// pressing a segment runs its action.
// `bgHover` restyles the background apart from the color, for a glyph shared
// by two blocks: its color is one block's, its background the next one's.
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
// `square` keeps a gauge a plain bar, a cell of fill before it, so its
// fill starts at its first cell and never at a rounded end.
type Seg = { key: string; parts: Part[]; action?: Action; square?: boolean }
// A statusline row: blocks from the left edge, blocks from the right, and
// the bar's fill between them.
type Line = { left: Seg[]; right: Seg[] }

// Widths in cells: a code point each, astral glyphs included.
const cells = (text: string) => [...text].length
const segWidth = (seg: Seg) => seg.parts.reduce((n, p) => n + cells(p.text), 0)
const sumWidth = (segs: Seg[]) => segs.reduce((n, x) => n + segWidth(x), 0)

const block = (text: string, bg: string, color = C.ink, bold = true): Part => ({ text, bg, color, bold })
const firstPart = (seg: Seg) => seg.parts[0] ?? { text: '' }
const lastPart = (seg: Seg) => seg.parts[seg.parts.length - 1] ?? { text: '' }

// A pressed segment's Button inverts under the pointer, its text color
// becoming its background; the glyphs at its edges are outside the Button, so
// they join its hover group and take that color with it.
const scopeOf = (seg: Seg) => (seg.action && seg.action.kind !== 'link' ? `sb-${seg.key}` : undefined)
const edge = (key: string, glyph: string, owner: Seg, part: Part, bg?: string): Seg => {
  const scope = scopeOf(owner)
  return {
    key,
    parts: [{ text: glyph, color: part.bg, bg, hover: scope ? { scope, color: part.color ?? C.ink } : undefined }],
  }
}
// The rounded end between two blocks: `owner`'s color over `under`'s
// background, each following its own block's hover.
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

// Blocks chain through rounded ends while the band is roomy, no gap between
// them: `| a )b )c )` from the left edge, `( a( b( c |` to the right one, flat
// at the band's edges; narrow, they sit square side by side.
// Gauges are square either way, a cell of fill before each.
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
// The cells a side spends beyond its blocks: one rounded end each, or the
// gauges' gaps.
const sideEnds = (segs: Seg[], round: boolean) =>
  !round ? segs.filter(x => x.square).length : segs.length
const lineWidth = (line: Line, round: boolean) =>
  sumWidth(line.left) + sumWidth(line.right) + sideEnds(line.left, round) + sideEnds(line.right, round)

// A filled progress bar with its label and percentage written inside it:
// the filled cells on the gauge's color, the rest on that color sunk dark.
// `weight` is its share of the gauges' room: the plan's limits get more than
// this conversation's context.
type Gauge = { key: string; icon: string; label: string; short: string; pct: number; base: string; extra: string | null; weight: number }

const MAX_CELLS = 28

const barText = (label: string, value: string, width: number) =>
  ` ${label}${' '.repeat(Math.max(1, width - label.length - value.length - 2))}${value} `

const labelOf = (g: Gauge, level: Level) =>
  `${g.icon} ${level === 'short' ? g.short : level === 'extra' && g.extra ? `${g.label} ${g.extra}` : g.label}`

// How a gauge is drawn, widest first: a bar with the long label and its
// extra (the reset, the tokens), without the extra, with the short label, the
// icon and percentage alone. Each is measured by the percentage it shows, so
// a gauge keeps its words while they fit at all.
type Level = 'extra' | 'long' | 'short' | 'chip'

const chipText = (g: Gauge) => ` ${g.icon} ${Math.round(g.pct)}% `

const gaugeWidth = (g: Gauge, level: Level) =>
  level === 'chip' ? chipText(g).length : barText(labelOf(g, level), `${Math.round(g.pct)}%`, 0).length

// A gauge keeps its own hue until it runs high, then turns red.
const gaugeColor = (g: Gauge) => (g.pct >= 80 ? C.red : g.base)

// Left-anchored eighths of a cell, for the fill's edge.
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']

// A gauge is a track with the fill inside it, the label in the gauge's own
// color over both and the fill paler than the label. The fill ends to the
// eighth of a cell where its edge falls on a blank, to the cell elsewhere;
// any use at all shows.
const gaugeSeg = (g: Gauge, width: number, level: Level): Seg => {
  const color = gaugeColor(g)
  const inner = level === 'chip' ? chipText(g) : barText(labelOf(g, level), `${Math.round(g.pct)}%`, width)
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

// Lays the gauges into the room given, never past it. Every gauge gets in as
// its icon and percentage before any is left out (the last first, and only
// when even those do not fit); the room past that is shared by weight, a
// gauge whose share is under its least keeping its least and the rest
// sharing what remains; each then takes the widest level its width holds.
export const fitGauges = (all: Gauge[], room: number): Seg[] => {
  for (let n = all.length; n > 0; n--) {
    const gauges = all.slice(0, n)
    // Each gauge brings the gap before it.
    const free = room - n
    const least = gauges.map(g => gaugeWidth(g, 'chip'))
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
      const level = (['extra', 'long', 'short'] as const).find(l => gaugeWidth(g, l) <= w) ?? 'chip'
      return gaugeSeg(g, level === 'chip' ? 0 : w, level)
    })
  }
  return []
}

// Packs segments into rows of at most `width`, a segment that does not fit
// starting the next row.
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

// The gauges, the plan's usage first, then this conversation's.
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

// Back to the band as it first draws: no drawer, no picker.
async function resetView($: any) {
  await update($, view, v => ({ ...v, drawer: null }))
  await update($, picker, () => null)
}

// resetView, writing only when something is open.
async function closeAll($: any) {
  if ((await read($, view)).drawer !== null || (await read($, picker)) !== null) await resetView($)
}

// The effort in force, kept for the next session so the band shows it before
// that session's first turn reports one.
async function setEffort($: any, effort: string | null) {
  await update($, snap, (s: Snap) => ({ ...s, effort }))
  if (effort !== null) await $.store.set(EFFORT_STORE_KEY, effort)
}

// The effort a run of /effort set: its argument, or the level its answer
// names when it was picked from the command's menu.
const effortOfRun = (args: string, text: string | undefined) => {
  const arg = args.trim().toLowerCase()
  if (EFFORTS.includes(arg)) return arg
  const said = /effort level to (\w+)/i.exec(text ?? '')?.[1]?.toLowerCase()
  return said && EFFORTS.includes(said) ? said : null
}

// Switches the model or effort as the person would by typing the command; the
// band shows the new one at once and the next turn confirms it.
async function apply($: any, which: 'model' | 'effort', value: string) {
  await update($, picker, () => null)
  try {
    await $.command.run({ command: which, args: value })
    if (which === 'effort') await setEffort($, value)
    else await update($, snap, (s: Snap) => ({ ...s, model: titleCase(value) }))
    refresh($).catch(() => undefined)
  } catch (err) {
    $.ui.toast(`Could not switch ${which}: ${String(err)}`)
  }
}

async function loadModelOptions($: any) {
  try {
    const row = (await $.config.list()).find((r: any) => r.key === 'model')
    const options = (row?.options ?? []).filter((o: string) => o && o.toLowerCase() !== 'default')
    if (options.length > 0) await update($, snap, (s: Snap) => ({ ...s, modelOptions: options }))
  } catch {
    // Keep the aliases.
  }
}

// Worktrees kept inside the project, under its own .claude/worktrees (or
// .claude/worktree), as `git worktree list` knows them.
const PROJECT_WORKTREE = /^\/\.claude\/worktrees?\//

async function refresh($: any) {
  const cwd = await $.session.cwd()
  const git = async (args: string[]) => {
    try {
      const r = await $.process.run(['git', '-C', cwd, '-c', 'core.fsmonitor=false', ...args], { timeoutMs: 4000 })
      return r.exitCode === 0 ? (r.stdout as string).trim() : null
    } catch {
      return null
    }
  }
  const branch = (await git(['symbolic-ref', '--short', 'HEAD'])) ?? (await git(['rev-parse', '--short', 'HEAD']))
  const status = branch !== null ? await git(['status', '--porcelain']) : null
  const changes = status ? status.split('\n').filter(l => l !== '').length : 0
  const dirty = changes > 0
  // Commits to push and to pull against the upstream, when there is one.
  const counts = branch !== null ? await git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']) : null
  const [behind, ahead] = (counts ?? '0 0').split(/\s+/).map(n => Number(n) || 0)

  const worktrees: Worktree[] = []
  if (branch !== null) {
    const top = await git(['rev-parse', '--show-toplevel'])
    // The main checkout, whichever worktree the session runs in.
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

  let prPatch = {}
  if (prTick++ % 12 === 0) {
    try {
      const r = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,reviewDecision,isDraft,url'], { cwd, timeoutMs: 8000 })
      if (r.exitCode === 0) {
        const j = JSON.parse(r.stdout)
        const state = j.isDraft ? 'draft' : j.reviewDecision === 'APPROVED' ? 'approved' : j.reviewDecision === 'CHANGES_REQUESTED' ? 'changes!' : ''
        prPatch = { pr: { number: j.number, title: j.title, state, url: j.url } }
      } else {
        prPatch = { pr: null }
      }
    } catch {
      prPatch = { pr: null }
    }
  }

  const usage = await $.session.usage()
  const c = usage.context
  // Before the first response nothing is counted yet: an empty window, not
  // an unknown one, so the gauges show from the session's start.
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

// Whether a drawing shows nothing: no text in it anywhere.
const isBlank = (el: any): boolean => {
  if (el === null || el === undefined || el === false) return true
  if (typeof el === 'string') return el.trim() === ''
  const children = el.props?.children ?? el.children
  if (el.type === 'Button') return false
  if (children === undefined) return true
  return (Array.isArray(children) ? children : [children]).every(isBlank)
}

// The band's id, where the focus ring for the pickers' arrows lives.
let aboveId: string | null = null

// Draws the band: the open list, if any, over the status rows. Null draws
// nothing, before a model is known.
async function drawBand($: any, e: any) {
    const s = await read($, snap)
    if (s.model === '') return null
    const v = await read($, view)
    const open = await read($, picker)
    const { Box, Text, Button, Link } = $.ui.resolve(e)

    // One column kept free so the last block never wraps; the roomy band
    // also keeps a margin on its left.
    const MARGIN = 1
    const fullWidth = Math.max(20, e.props.bodyColumns - 1)
    const effortBg = s.effort ? (effortColor[s.effort] ?? C.claude) : C.block

    // Row 1, like vim's mode block: the model, the effort and its level, then
    // the worktree and agent buttons on the right, one row at any width.
    // The model's name: whole with its context size, whole, or as its
    // initial and version once room runs short.
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
    // One run of one color, so the Button inverts it whole.
    const effortSeg = (withIcon: boolean): Seg => ({
      key: 'effort',
      parts: [block(` ${withIcon ? `${I.effort} ` : ''}${s.effort ?? 'effort'} `, effortBg, s.effort ? C.ink : C.text)],
      action: { kind: 'pick', which: 'effort' },
    })


    // The picker, under row 1 while open; the one part of the band that wraps.
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

    // Row 2: where the session works: the path, the branch and its state, the
    // PR, and on the right the gauges.
    const running = s.agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').length
    const wtSeg: Seg = {
      key: 'wt',
      parts: [block(` ${I.tree} `, C.teal)],
      action: { kind: 'drawer', which: 'worktrees' },
    }
    const agSeg: Seg = {
      key: 'ag',
      // Green while an agent runs; the counts are in the drawer.
      parts: [block(` ${I.robot} `, running > 0 ? C.green : C.lavender)],
      action: { kind: 'drawer', which: 'agents' },
    }
    // Switches between the full band and one row of it.
    const compactSeg: Seg = {
      key: 'compact',
      parts: [block(` ${v.compact ? I.expand : I.compress} `, C.block, C.text)],
      action: { kind: 'compact' },
    }
    // The path on a neutral slate: every hue is taken by a model or an
    // effort, which sit just above it.
    const pathSeg = (path: string): Seg => ({ key: 'cwd', parts: [block(` ${I.folder} ${path} `, PATH_BG, C.text)] })
    // The branch, then what it has to push (↑), to pull (↓) and left
    // uncommitted (±), each only while there is some; ✓ when all is clean.
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
    const left2 = (path: string, branch: string | null, title: string | null): Seg[] => [
      pathSeg(path),
      ...(branch === null ? [] : [branchSeg(branch)]),
      prSeg(title),
    ]
    // The band as wide as it can be drawn: roomy (a margin, rounded ends) while
    // everything fits whole, else narrow (square, no margin).
    const layout = (round: boolean) => {
      const width = round ? fullWidth - MARGIN : fullWidth
      // The left side gives up the model's context size, then its name for
      // its initial, then its icons.
      let line1: Line = { left: [], right: [] }
      let full = false
      for (const [form, withIcon] of [['ctx', true], ['name', true], ['short', true], ['short', false]] as const) {
        line1 = { left: [modelSeg(form, withIcon), effortSeg(withIcon)], right: [wtSeg, agSeg, compactSeg] }
        if (lineWidth(line1, round) + 1 <= width) {
          full = form === 'ctx'
          break
        }
      }
      // Row 2: the branch's name past twelve letters gives way first, then
      // the PR's title, then the path, cut at its start.
      const MIN_PATH = 14
      const bare = (branch: string | null) => lineWidth({ left: left2('', branch, null), right: [] }, round)
      let branch = s.branch
      if (width - bare(branch) - 1 < MIN_PATH && branch !== null && branch.length > 12) {
        branch = cut(branch, Math.max(12, branch.length - (MIN_PATH - (width - bare(branch) - 1))))
      }
      const room = width - bare(branch) - 1
      const fullPath = shortenPath(s.cwd, home, Infinity)
      const pathLen = Math.min(fullPath.length, Math.max(6, room))
      const titleRoom = room - pathLen - 1
      const title = s.pr && titleRoom >= 6 ? cut(s.pr.title, titleRoom) : null
      const line2: Line = { left: left2(shortenPath(s.cwd, home, pathLen), branch, title), right: [] }
      const fits = full && pathLen === fullPath.length
      return { round, width, line1, line2, fits }
    }
    // Compact: everything on one row, square, the switch back fixed at the
    // right end as in the full band. As room runs short the model goes to its
    // initial, the icons and the branch's length go, then the PR, the branch,
    // the drawer buttons, and last the path, so the switch always shows.
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
      // One list open at a time: opening one closes whatever else was open.
      if (a.kind === 'drawer') {
        await update($, picker, () => null)
        return update($, view, x => ({ ...x, drawer: x.drawer === a.which ? null : a.which }))
      }
      if (a.kind === 'pick') {
        await update($, view, x => ({ ...x, drawer: null }))
        const opening = (await read($, picker)) !== a.which
        await update($, picker, () => (opening ? a.which : null))
        // The ring starts on the option in force, so the arrows move from it
        // and Enter picks; the band holds the keys since the press.
        if (opening) {
          const options = a.which === 'model' ? s.modelOptions : EFFORTS
          const current = options.find(o => (a.which === 'model' ? isCurrentModel(o, s.model) : o === s.effort)) ?? options[0]
          if (current && aboveId) $.ui.focus({ requestId: aboveId, key: `pick-${current}` }).catch(() => undefined)
        }
        return
      }
      if (a.kind === 'compact') {
        const compact = !v.compact
        await update($, view, x => ({ ...x, compact }))
        return $.store.set(COMPACT_STORE_KEY, compact)
      }
      if (a.kind === 'close') return update($, picker, () => null)
      if (a.kind === 'set') return apply($, a.which, a.value)
    }

    const texts = (key: string, parts: Part[]) =>
      parts.filter(p => p.text !== '').map((p, j) =>
        // A block's end follows its Button's hover but must not light it: a
        // Text nested in a Text follows its group without heating it, so the
        // pointer on the end alone changes nothing, as on the Button's edge.
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

    // The drawers: worktrees and subagents, one row each, each on its button.
    // Each row is pressed to close its drawer, like a click anywhere else.
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

    // The open list sits above the band, a row of space between, so the
    // status rows stay where they are.
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

// The gauges, on the hint line under the prompt: beside the engine's mode
// pill (`⏵⏵ auto mode on`), which it keeps to the left of a hook's tree, with
// the rest of the hint before them.
async function drawHint($: any, e: any) {
  const s = await read($, snap)
  if (s.model === '') return null
  const gauges = gaugesOf(s)
  if (gauges.length === 0) return null
  const { Box, Text } = $.ui.resolve(e)
  const hint: string = e.props.hint ?? ''
  // The hint's two leading columns, the pill's while a mode is on (its hint
  // then reads `(shift+tab to cycle)`), and one kept free.
  const pill = /shift\+tab to cycle/.test(hint) ? 18 : 0
  const width = Math.max(20, (e.viewport?.columns ?? 100) - 2 - pill - 1)
  // The gauges take at most half the line; the hint keeps what they leave,
  // cut at its end.
  const segs = fitGauges(gauges, Math.min(Math.floor(width / 2), width - Math.min(hint.length, 12) - 1))
  const parts = segs.flatMap(seg => [gapSeg(`_${seg.key}`), seg]).flatMap(seg => seg.parts.map((p, j) => ({ ...p, key: `${seg.key}${j}` })))
  return (
    <Box overflow="hidden">
      <Box key="hint" flexShrink={1} flexGrow={1}>
        <Text dimColor wrap="truncate-end">
          {hint}
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
    home = (await $.process.run(['sh', '-c', 'printf %s "$HOME"'])).stdout
    if ((await $.store.get(COMPACT_STORE_KEY)) === true) await update($, view, v => ({ ...v, compact: true }))
    const effort = (await $.store.get(EFFORT_STORE_KEY)) as string | undefined
    if (effort) await update($, snap, (s: Snap) => (s.effort === null ? { ...s, effort } : s))
    void loadModelOptions($)
    $.clock.every(5000, () => void refresh($))
    void refresh($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // A subagent's step speaks of its own model and effort, not the session's.
    if (!e.agentId) {
      await update($, snap, (s: Snap) => ({ ...s, model: e.model }))
      if (e.effort !== undefined) await setEffort($, String(e.effort))
    }
    return yield* next(e)
  })

  // /effort, typed or picked from its menu, shows at once.
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    if (e.command === 'effort') {
      const effort = effortOfRun(e.args, r.text)
      if (effort) await setEffort($, effort)
    }
    return r
  })

  // A click elsewhere in the shell raises nothing a plugin hears; typing in
  // the prompt or sending it is the sign the person has moved on.
  on('prompt.edit', async ($, e, next) => {
    await closeAll($)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await closeAll($)
    return next(e)
  })

  // The band is pressed with the pointer; the ring is for the picker alone.
  on('ui.focus', async ($, e, next) => {
    if (e.component !== 'AbovePrompt') return next(e)
    // A click on the band off its buttons puts it back as it first draws.
    if (!e.element || e.plugin !== 'statusbar') await resetView($)
    // Only the picker's options take the ring, for the arrow keys; elsewhere
    // a ring would leave a block drawn inverted after a click.
    if (e.plugin === 'statusbar' && !e.element?.startsWith('pick-')) return { deny: 'statusbar takes no focus' }
    return next(e)
  })

  // Who speaks, told by a gutter down the left side: Claude's own color on
  // its replies; the person's prompts also take a faint wash of theirs. A
  // warm wash under Claude's read as a warning, so it has none.
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

  // The band, under whatever the hooks beneath draw (another mod's list, as
  // the file picker's), so neither hides the other.
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
