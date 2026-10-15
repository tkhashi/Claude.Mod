import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Agent, Picker, Snap, View, Worktree } from '../types'

// statusbar mod のうち、押せるものだけを受け持つ mod。表示するだけのもの(作業場所・
// git・PR・使用量ゲージ)は、Claude Code の statusLine に出す `statusline/statusline.ts`
// が受け持つ。ボタンは statusLine の直下、プロンプト下のヒント行の右端に並べ、押して開
// く選択肢や一覧は、プロンプトの上に出す。

// エイリアスは常に各ファミリーの最新モデルを指すので、新しいモデルが出てもピッカーが追
// 従する。/config のメニューにモデルの選択肢が無いときに使う。
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const empty: Snap = {
  model: '',
  effort: null,
  modelOptions: MODEL_ALIASES,
  worktrees: [],
  agents: [],
}

const snap = atom({ plugin: 'statusbar-buttons', key: 'snap' } as const, empty)
const view = atom({ plugin: 'statusbar-buttons', key: 'view' } as const, { drawer: null } as View)
const picker = atom({ plugin: 'statusbar-buttons', key: 'picker' } as const, null as Picker)

const EFFORT_STORE_KEY = 'effort'

// statusbar mod と同じ、暗い画面向けの独自パレット(Catppuccin Mocha)。
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

// Powerline と Nerd Font のグリフ。
const I = {
  capL: '\u{e0b6}',
  capR: '\u{e0b4}',
  model: '✻',
  effort: '\u{f0e4}',
  folder: '\u{f07c}',
  branch: '\u{f418}',
  tree: '\u{f0531}',
  robot: '\u{ee0d}',
  current: '\u{f04b}',
}

const effortColor: Record<string, string> = {
  max: C.red,
  xhigh: C.peach,
  high: C.yellow,
  medium: C.green,
  low: C.teal,
}

// effort 側の色とは重ならない色にしてある。隣り合う model と effort のブロックが同じ色
// にならないようにするため。
const familyColor: Record<string, string> = { opus: C.mauve, sonnet: C.blue, haiku: C.lavender, fable: C.pink }

const modelColor = (model: string) => {
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)?.[1]?.toLowerCase()
  return (family && familyColor[family]) || C.claude
}

const agentStatus: Record<string, { icon: string; color: string }> = {
  pending: { icon: '\u{f252}', color: C.dim },
  running: { icon: '\u{f04b}', color: C.green },
  waiting: { icon: '\u{f04c}', color: C.yellow },
  idle: { icon: '\u{f10c}', color: C.dim },
  completed: { icon: '\u{f49e}', color: C.sky },
  failed: { icon: '\u{f467}', color: C.red },
  killed: { icon: '\u{f05e}', color: C.red },
}

const shortenPath = (p: string, home: string, max: number) => {
  const q = home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p
  if (q.length <= max) return q
  return `…${q.slice(q.length - Math.max(5, max - 1))}`
}

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

// 最も短いモデル名。ファミリーの頭文字とバージョンで、"Sonnet 5.5" なら `S5.5`。
const shortModel = (id: string) => {
  const [family, ...rest] = prettyModel(id, false).split(' ')
  return `${(family ?? '').charAt(0)}${rest.join('')}`
}

// 選択肢が今動いているモデルを指しているか。"claude-opus-5-5" には "opus" が当たり、
// "opus[1m]" は 1M コンテキストのときだけ当たる。
const isCurrentModel = (option: string, model: string) => {
  const o = option.toLowerCase()
  const m = model.toLowerCase()
  if (o === m) return true
  // エイリアスはファミリーを表し、`[1m]` が付けばコンテキストサイズも表す。両方が一致
  // する必要がある。
  const ctx = (x: string) => /\[(\d+[km])\]$/.exec(x)?.[1] ?? ''
  const family = o.replace(/\[[^\]]*\]$/, '')
  return /^[a-z]+$/.test(family) && m.includes(family) && ctx(o) === ctx(m)
}

// スタイル付きの文字列ひと続き。セグメントはこれを横に並べたもので、押すとそのアクショ
// ンが走る。`bgHover` は文字色とは別に背景色を hover で変える。2つのブロックが共有する
// グリフ用で、文字色は片方のブロック、背景色は隣のブロックに従う。
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
  | { kind: 'pick'; which: 'model' | 'effort' }
  | { kind: 'set'; which: 'model' | 'effort'; value: string }
  | { kind: 'close' }
type Seg = { key: string; parts: Part[]; action?: Action }

// 幅はマス数で数える。サロゲートペアのグリフも含めて1コードポイント1マス。
const cells = (text: string) => [...text].length
const segWidth = (seg: Seg) => seg.parts.reduce((n, p) => n + cells(p.text), 0)
const sumWidth = (segs: Seg[]) => segs.reduce((n, x) => n + segWidth(x), 0)

const block = (text: string, bg: string, color = C.ink, bold = true): Part => ({ text, bg, color, bold })
const firstPart = (seg: Seg) => seg.parts[0] ?? { text: '' }
const lastPart = (seg: Seg) => seg.parts[seg.parts.length - 1] ?? { text: '' }

// 押せるセグメントの Button はポインタの下で反転し、文字色が背景色になる。両端のグリフ
// は Button の外にあるので、同じ hover グループに入れてその色に追従させる。
const scopeOf = (seg: Seg) => (seg.action ? `sb-${seg.key}` : undefined)

// 2つのブロックの間の角丸。文字色は `owner` の色、背景は `under` の色で、それぞれ自分の
// ブロックの hover に従う。
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

// 幅に余裕がある間は、ブロックを隙間なく角丸でつなぐ。右端へは `( a( b( c |` の形で、
// 右端は平らにする。狭いときは四角いブロックを並べるだけにする。
const rightSide = (segs: Seg[], round: boolean) =>
  !round
    ? segs
    : segs.flatMap((seg, i) => {
        const prev = segs[i - 1]
        return [joint(`(${seg.key}`, I.capL, seg, firstPart(seg), prev, prev && lastPart(prev)), seg]
      })
const lineWidth = (segs: Seg[], round: boolean) => sumWidth(segs) + (round ? segs.length : 0)

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

// 帯を最初の状態に戻す。一覧もピッカーも閉じる。
async function resetView($: any) {
  await update($, view, v => ({ ...v, drawer: null }))
  await update($, picker, () => null)
}

// 何か開いているときだけ書き込む resetView。
async function closeAll($: any) {
  if ((await read($, view)).drawer !== null || (await read($, picker)) !== null) await resetView($)
}

// 今の effort。次のセッション用に保存しておき、そのセッションの最初のターンで値が届く
// 前からボタンに出せるようにする。
async function setEffort($: any, effort: string | null) {
  await update($, snap, (s: Snap) => ({ ...s, effort }))
  if (effort !== null) await $.store.set(EFFORT_STORE_KEY, effort)
}

// /effort の実行で設定された effort。引数か、コマンドのメニューから選んだ場合は出力に書
// かれたレベル。
const effortOfRun = (args: string, text: string | undefined) => {
  const arg = args.trim().toLowerCase()
  if (EFFORTS.includes(arg)) return arg
  const said = /effort level to (\w+)/i.exec(text ?? '')?.[1]?.toLowerCase()
  return said && EFFORTS.includes(said) ? said : null
}

// コマンドを打つのと同じ方法で model や effort を切り替える。ボタンにはすぐ反映し、次の
// ターンで確定する。
async function apply($: any, which: 'model' | 'effort', value: string) {
  await update($, picker, () => null)
  // コマンドはターンが終わるまで待たされる。ボタンには選んだ値をすぐ出し、コマンドが失
  // 敗したら元に戻す。
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

// プロジェクト内(そのプロジェクトの .claude/worktrees か .claude/worktree の下)に置か
// れた worktree を、`git worktree list` の情報から拾う。
const PROJECT_WORKTREE = /^\/\.claude\/worktrees?\//

// refresh は同時に1つだけ。実行中に頼まれた分は終わった後に1回だけ走らせる。遅い実行が
// 新しい結果を上書きしないようにするため。
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
  const top = await git(['rev-parse', '--show-toplevel'])
  const worktrees: Worktree[] = []
  if (top !== null) {
    // セッションがどの worktree で動いていても、メインのチェックアウトを基準にする。
    const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const main = common ? common.replace(/\/\.git\/?$/, '') : top
    for (const chunk of ((await git(['worktree', 'list', '--porcelain'])) ?? '').split('\n\n')) {
      const path = /^worktree (.+)$/m.exec(chunk)?.[1]
      if (!path || !path.startsWith(`${main}/`) || !PROJECT_WORKTREE.test(path.slice(main.length))) continue
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

  const model = await $.session.model()
  await update($, snap, (s: Snap) => ({ ...s, model, worktrees, agents }))
}

let home = ''
let timer: { cancel: () => void } | null = null

// ボタンで扱える effort レベル。それ以外(数値のバジェット、古い版で保存された値)は
// null。
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

// 押したときの動き。ボタン(ヒント行)と選択肢(プロンプト上)の両方から呼ぶ。
const press = ($: any, a: Action) => async () => {
  // 一覧は同時に1つだけ開く。1つ開くと、ほかに開いていたものは閉じる。
  if (a.kind === 'drawer') {
    await update($, picker, () => null)
    return update($, view, x => ({ ...x, drawer: x.drawer === a.which ? null : a.which }))
  }
  if (a.kind === 'pick') {
    await update($, view, x => ({ ...x, drawer: null }))
    const opening = (await read($, picker)) !== a.which
    await update($, picker, () => (opening ? a.which : null))
    // フォーカスリングは今の選択肢から始める。矢印キーでそこから動かし、Enter で決定す
    // る。選択肢はプロンプト上の帯に出るので、フォーカスもそこへ送る。
    if (opening && aboveId) {
      const s = await read($, snap)
      const options = a.which === 'model' ? s.modelOptions : EFFORTS
      const current = options.find(o => (a.which === 'model' ? isCurrentModel(o, s.model) : o === s.effort)) ?? options[0]
      if (current) $.ui.focus({ requestId: aboveId, key: `pick-${current}` }).catch(() => undefined)
    }
    return
  }
  if (a.kind === 'close') return update($, picker, () => null)
  if (a.kind === 'set') return apply($, a.which, a.value)
}

const texts = (Text: any, key: string, parts: Part[]) =>
  parts.filter(p => p.text !== '').map((p, j) =>
    // ブロックの端は Button の hover に追従するが、自分から点灯させてはいけない。Text の
    // 中に入れた Text はグループに追従するだけで点灯させないので、端だけにポインタを乗せ
    // ても何も変わらない(Button の縁に乗ったときと同じ)。
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

const drawSeg = ($: any, ui: any, seg: Seg) => {
  const { Button, Text } = ui
  const a = seg.action
  if (!a) return texts(Text, seg.key, seg.parts)
  const scope = scopeOf(seg)
  return (
    <Button key={seg.key} plain hover={scope ? { scope } : undefined} onPress={press($, a)}>
      {texts(Text, seg.key, seg.parts)}
    </Button>
  )
}

const segBox = ($: any, ui: any) => {
  const { Box } = ui
  return (seg: Seg) => (
    <Box key={seg.key} flexShrink={0}>
      {drawSeg($, ui, seg)}
    </Box>
  )
}

// プロンプト上の帯の id。ピッカーを矢印キーで動かすためのフォーカスリングがここにある。
let aboveId: string | null = null

// ボタン。model、effort、worktree、サブエージェントを右端から並べる。どの幅でも1行に収
// める。model 名はコンテキストサイズ付き、名前だけ、幅が足りなくなったら頭文字とバー
// ジョン、の順に縮める。一番狭いときはドロワーのボタンも外す。
const buttonsOf = (s: Snap, room: number): { segs: Seg[]; round: boolean } => {
  const effortBg = s.effort ? (effortColor[s.effort] ?? C.claude) : C.block
  const running = s.agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').length
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
  const effortSeg = (withIcon: boolean): Seg => ({
    key: 'effort',
    parts: [block(` ${withIcon ? `${I.effort} ` : ''}${s.effort ?? 'effort'} `, effortBg, s.effort ? C.ink : C.text)],
    action: { kind: 'pick', which: 'effort' },
  })
  const wtSeg: Seg = { key: 'wt', parts: [block(` ${I.tree} `, C.teal)], action: { kind: 'drawer', which: 'worktrees' } }
  // エージェントが動いている間は緑。件数は一覧の中で見る。
  const agSeg: Seg = { key: 'ag', parts: [block(` ${I.robot} `, running > 0 ? C.green : C.lavender)], action: { kind: 'drawer', which: 'agents' } }
  const tries = [
    ['ctx', true, true],
    ['name', true, true],
    ['short', true, true],
    ['short', false, true],
    ['short', false, false],
  ] as const
  const build = ([form, withIcon, drawers]: (typeof tries)[number]): Seg[] => [
    modelSeg(form, withIcon),
    effortSeg(withIcon),
    ...(drawers ? [wtSeg, agSeg] : []),
  ]
  // 幅に余裕がある間は角丸でつなぎ、足りなければ四角いブロックを並べる。
  const roundFit = tries.find(t => lineWidth(build(t), true) <= room)
  if (roundFit) return { segs: build(roundFit), round: true }
  const squareFit = tries.find(t => lineWidth(build(t), false) <= room) ?? tries[tries.length - 1]!
  return { segs: build(squareFit), round: false }
}

// プロンプト下のヒント行に描くボタン。本体はモード表示(`⏵⏵ auto mode on`)をフックの描
// 画の左に残すので、その右にヒント文の残りを、さらに右端にボタンを並べる。
async function drawHint($: any, e: any) {
  const s = await read($, snap)
  if (s.model === '') return null
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const hint: string = e.props.hint ?? ''
  // ヒント行の先頭2マス、モード表示中はその分(このときヒント文は `(shift+tab to cycle)`
  // を含む)、それと1マスの余裕を差し引く。
  const pill = /shift\+tab to cycle/.test(hint) ? 18 : 0
  const width = Math.max(20, (e.viewport?.columns ?? 100) - 2 - pill - 1)
  const { segs, round } = buttonsOf(s, width)
  return (
    <Box overflow="hidden">
      <Box key="hint" flexShrink={1} flexGrow={1}>
        <Text dimColor wrap="truncate-end">
          {hint}
        </Text>
      </Box>
      <Box key="buttons" flexShrink={0}>
        {rightSide(segs, round).map(segBox($, ui))}
      </Box>
    </Box>
  )
}

// 押して開いた選択肢と一覧を、プロンプトの上に出す。開いていないときは何も描かない。
async function drawLists($: any, e: any) {
  const s = await read($, snap)
  const v = await read($, view)
  const open = await read($, picker)
  const ui = $.ui.resolve(e)
  const { Box, Button, Text } = ui
  const fullWidth = Math.max(20, e.props.bodyColumns - 1)

  // ピッカー。折り返しながら並べる。
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

  // ドロワー。worktree とサブエージェントを、それぞれのボタンで1行ずつ一覧表示する。どの
  // 行を押してもドロワーは閉じる(他の場所をクリックしたときと同じ)。
  const row = (key: string, parts: Part[]) => (
    <Box key={key}>
      <Button key={`${key}-b`} plain onPress={() => resetView($)}>
        {texts(Text, key, parts)}
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
                { text: shortenPath(w.path, home, Math.max(12, fullWidth - 34)), color: C.blue },
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

  const lists = [
    ...pickerRows.map((r, i) => (
      <Box key={`p${i}`} columnGap={GAP}>
        {r.map(segBox($, ui))}
      </Box>
    )),
    ...worktreeRows,
    ...agentRows,
  ]
  if (lists.length === 0) return null
  return (
    <Box key="lists" flexDirection="column" marginTop={1}>
      {lists}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 各処理を独立させる。どれかが失敗しても(HOME が無い、ストアが読めない)タイマーは必
    // ず起動させる。
    try {
      home = (await $.process.run(['sh', '-c', 'printf %s "$HOME"'])).stdout
    } catch {
      home = ''
    }
    try {
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
    // サブエージェントのステップは、セッションではなくそのエージェント自身の model と
    // effort を表す。
    if (!e.agentId) {
      await update($, snap, (s: Snap) => ({ ...s, model: e.model }))
      // ボタンで扱えるレベルだけ採る。effort の無いモデル(値が送られない)や数値のバジェッ
      // トのときは、古い値を残さず effort なしにする。
      await update($, snap, (s: Snap) => ({ ...s, effort: effortOf(e.effort) }))
      const effort = effortOf(e.effort)
      if (effort) await $.store.set(EFFORT_STORE_KEY, effort)
    }
    return yield* next(e)
  })

  // /effort は、打った場合もメニューから選んだ場合も、すぐボタンに反映する。
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    if (e.command === 'effort') {
      const effort = effortOfRun(e.args, r.text)
      if (effort) await setEffort($, effort)
    }
    return r
  })

  // シェルの別の場所をクリックしても、プラグインに届くイベントは無い。プロンプトへの入力
  // や送信を「別の操作に移った」合図とみなす。
  on('prompt.edit', async ($, e, next) => {
    await closeAll($)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await closeAll($)
    return next(e)
  })

  // プロンプト上の帯のボタン以外の部分をクリックしたら、最初の状態に戻す。矢印キー用にフォ
  // ーカスリングを受け取るのはピッカーの選択肢だけ。それ以外で受け取ると、クリックの後に
  // ブロックが反転したまま残ってしまう。
  on('ui.focus', async ($, e, next) => {
    if (e.component !== 'AbovePrompt') return next(e)
    if (!e.element || e.plugin !== 'statusbar-buttons') await resetView($)
    if (e.plugin === 'statusbar-buttons' && !e.element?.startsWith('pick-')) return { deny: 'statusbar-buttons takes no focus' }
    return next(e)
  })

  // 選択肢と一覧は、下位のフックの描画(ファイルピッカーなど他の mod の一覧)の下に置き、
  // 互いに隠さないようにする。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    aboveId = e.requestId
    const lists = await drawLists($, e)
    if (!lists) return next(e)
    const rest = await next(e)
    if (isBlank(rest)) return lists
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rest}
        {lists}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => (await drawHint($, e)) ?? next(e))
}
