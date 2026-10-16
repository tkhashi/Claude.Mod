import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Call, Step, Turn, View } from '../types'

// ペインの id。コマンドもこの名前(`/peek`)。
const PANE = 'peek'
// これより狭いペインでは、見出しを数字だけにし、ツールの入力を1行に畳む。
const NARROW = 48
// 1つのテキスト(発言、thinking、結果)を描く文字数の上限。
const MAX_CHARS = 12000
// ツール呼び出しの見出しに使う、入力の主な引数の最大文字数。
const MAX_SUBJECT = 200
// 本体はトランスクリプトの行を字下げして描くので、1行に収める行はその分狭く見
// 積もる。
const GUTTER = 4

const I = {
  open: '\u{f06e}',
  latest: '\u{f051}',
  reload: '\u{f021}',
}

const closed: View = {
  open: false,
  at: null,
  total: 0,
  follow: true,
  prompt: false,
  segments: [],
  target: null,
  version: 0,
  note: null,
}
const pane = atom({ plugin: 'peek', key: 'pane' } as const, closed)

// トランスクリプトの、途中の発言(後にツール呼び出しなどが続いた発言)の本文を
// 詰めたもの。量が多いのでストアには置かず、変えたら marks を上げて、それを読
// んだ発言の行を描き直させる。
let mids: string[] = []
const marks = atom({ plugin: 'peek', key: 'marks' } as const, 0)

// トランスクリプトの詳しさ。1 はすべて(途中の発言、1行に畳んだツール呼び出し)、
// 2 はツール呼び出しを隠し、3 は途中の発言と要約の行も隠して、プロンプトと Claude
// の最後の発言だけにする。プロンプトと最後の発言のブロックの右下のボタンか
// `/peek 1|2|3` で切り替え、ストアに覚えておく。
export type Level = 1 | 2 | 3
let level: Level = 1
const LEVEL_KEY = 'level'
// 前の版のまとめ表示のオン・オフ。オンだったら 3 から始める。
const COMPACT_KEY = 'compact'
// ボタンの名前。狭いトランスクリプトでは短くする。
const LEVEL_NAMES: Record<Level, { wide: string; narrow: string }> = {
  1: { wide: 'all', narrow: 'all' },
  2: { wide: 'no tools', narrow: 'msgs' },
  3: { wide: 'answers', narrow: 'ans' },
}
const LEVELS: Record<Level, string> = {
  1: 'Level 1: prompts, Claude’s messages, tool calls and answers',
  2: 'Level 2: prompts, Claude’s messages and answers',
  3: 'Level 3: prompts and answers',
}
// ターンの最後の発言(答え)の本文を詰めたもの。量が多いのでストアには置かず、変
// えたら marks を上げる。
let finals: string[] = []
// 本体の会話のツール呼び出しの id。2 と 3 ではこれらの行を隠す。サブエージェン
// トの画面の行は知らないので、いつもどおり1行ずつ描く。
let callIds = new Set<string>()

// 読み込んだ会話のターンと、それがどのエージェントの会話か(本体は null)。量が
// 多いのでストアには置かず、変えたら pane の version を上げて描き直させる。
let turns: Turn[] = []
let agentId: string | null = null
// 最後に測られたターミナルの大きさと、fullscreen 表示か(まだ測られていなけれ
// ば undefined)。ペインを開くときに希望する幅と高さ、置ける場所に使う。
let terminal: { columns: number; rows: number; fullscreen?: boolean } = { columns: 120, rows: 40 }
// ctrl+o のトランスクリプトや --verbose で、行を全部見せているか。ツールの行
// はそれを知らないので、本人のプロンプトの行が持つ値を写しておく。
let isExpandedView = false
// 要約の行の背景の灰色。明るいテーマでは薄い灰色にする。
let isLightTheme = false
const lightOf = (theme: unknown) => typeof theme === 'string' && theme.startsWith('light')
const summaryBg = () => (isLightTheme ? 'ansi256(254)' : 'ansi256(236)')
// 会話の中の背景。プロンプト、Claude の最後の発言、途中の発言、ツール呼び出し
// の見出し、その入力と結果、失敗した結果。トランスクリプトの発言とペインで同じ
// 色を使い、プロンプトは水色、最後の発言は Claude の色を薄く敷き、途中の発言は
// 灰色にする。左の縦線の色(user、claude)もそれに合わせる。
const SHADES = {
  dark: {
    prompt: '#2d3948',
    reply: '#312732',
    message: '#303030',
    user: '#89dceb',
    claude: '#d97757',
    head: '#2b303b',
    input: '#1e2430',
    result: '#1f2722',
    error: '#3b2226',
    chip: '#1e1e2e',
    hover: '#45475a',
    frame: '#b4befe',
  },
  light: {
    prompt: '#e1f0f5',
    reply: '#f8ebe6',
    message: '#eeeeee',
    user: '#04a5e5',
    claude: '#d97757',
    head: '#e6e9ef',
    input: '#e8eef8',
    result: '#e9f3eb',
    error: '#f9e4e4',
    chip: '#ffffff',
    hover: '#ccd0da',
    frame: '#7287fd',
  },
}
const shades = () => (isLightTheme ? SHADES.light : SHADES.dark)
// ペインの閉じるボタンの背景。指を載せると赤みを帯びる。
const CLOSE = {
  dark: { bg: '#3a3a3a', hover: '#6b2c2c' },
  light: { bg: '#dedede', hover: '#f2c4c4' },
}

// MARK: 会話の読み取り

type Block = { type: string; [field: string]: unknown }
type ApiMessage = { role: 'user' | 'assistant'; content: Block[] }

// エンジンがユーザーのメッセージやツールの結果に差し込むリマインダー。
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

// tool_result の中身を文字列にする。文字列か、ブロックの配列(テキスト、画像な
// ど)。テキスト以外は種類だけ書く。
export const resultText = (content: unknown): string => {
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : `[${String(c?.type ?? 'block')}]`)).join('\n')
        : ''
  return raw.replace(REMINDER, '').trimEnd()
}

// ユーザーのメッセージのテキストから、本人が書いたものを取り出す。リマインダー
// とコマンドの出力を除き、スラッシュコマンドは `/name args` の形に戻す。
export const spokenOf = (text: string): string => {
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
  return text
    .replace(REMINDER, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, (_, name: string) => `${name.trim()}${args ? ` ${args}` : ''}`)
    .replace(/<(command-args|command-message|local-command-caveat|local-command-stdout|local-command-stderr)>[\s\S]*?<\/\1>/g, '')
    .trim()
}

// API 形式の会話をターンに分ける。ターンは本人のプロンプトと、次のプロンプト
// までに Claude がしたこと(発言、thinking、次のユーザーメッセージで返った結果
// つきのツール呼び出し)。そのうち最後の発言が答えで、残りが途中経過。
export const turnsOf = (messages: readonly ApiMessage[]): Turn[] => {
  const out: Turn[] = []
  const byId = new Map<string, Call>()
  const add = (step: Step) => {
    // 最初のプロンプトより前のもの(圧縮の直後など)は、プロンプトの無いターンに入れる。
    if (out.length === 0) out.push({ prompt: '', steps: [], reply: -1 })
    const steps = out[out.length - 1]!.steps
    const last = steps[steps.length - 1]
    // 途中経過を挟まずに続くテキストは1つの発言。
    if (step.kind === 'text' && last?.kind === 'text') last.text += `\n\n${step.text}`
    else steps.push(step)
  }
  for (const m of messages) {
    if (!Array.isArray(m?.content)) continue
    if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') add({ kind: 'text', text: b.text.trim() })
        else if (b.type === 'thinking') add({ kind: 'thinking', text: typeof b.thinking === 'string' ? b.thinking.trim() : '' })
        else if (b.type === 'redacted_thinking') add({ kind: 'redacted' })
        else if (b.type === 'tool_use' && typeof b.id === 'string') {
          const call: Call = { id: b.id, tool: String(b.name ?? '?'), input: b.input, result: null, isError: false }
          byId.set(b.id, call)
          add({ kind: 'call', call })
        }
      }
      continue
    }
    const said: string[] = []
    for (const b of m.content) {
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const call = byId.get(b.tool_use_id)
        if (!call) continue
        call.result = resultText(b.content)
        call.isError = b.is_error === true
      } else if (b.type === 'text' && typeof b.text === 'string') {
        const text = spokenOf(b.text)
        if (text !== '') said.push(text)
      } else if (b.type === 'image' || b.type === 'document') said.push(`[${b.type}]`)
    }
    if (said.length > 0) out.push({ prompt: said.join('\n\n'), steps: [], reply: -1 })
  }
  // 最後の発言の後にまだ呼び出しが続いている(実行中、中断された)ターンでも、
  // それまでで最後の発言を答えとして見せる。
  for (const turn of out) {
    let i = turn.steps.length - 1
    while (i >= 0 && turn.steps[i]!.kind !== 'text') i--
    turn.reply = i
  }
  return out
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

// 途中の発言の本文。ターンの最後の一歩でない発言(後に呼び出しや thinking が続
// いた)を、詰めて返す。
export const midsOf = (list: readonly Turn[]) =>
  list.flatMap(turn => turn.steps.flatMap((s, i) => (s.kind === 'text' && i < turn.steps.length - 1 ? [squash(s.text)] : [])))

// ターンの最後の発言(答え)の本文。最後の一歩が発言で終わったターンの、その発言
// を詰めて返す。
export const finalsOf = (list: readonly Turn[]) =>
  list.flatMap(turn => {
    const last = turn.steps[turn.steps.length - 1]
    return last?.kind === 'text' ? [squash(last.text)] : []
  })

// トランスクリプトの発言の行が途中の発言か。行は1ブロックずつで、続くブロッ
// クをまとめた発言の一部のことがあるので、短すぎない行は含まれていればよい。
export const isMid = (list: readonly string[], text: string) => {
  const s = squash(text)
  return s !== '' && list.some(m => m === s || (s.length >= 20 && m.includes(s)))
}

export const stepKey = (t: number, i: number) => `peek-step-${t}-${i}`

// 文字の2文字ずつの組の数。要約と元の文の近さを測るのに使う。
const pairsOf = (text: string) => {
  const s = squash(text).toLowerCase()
  const pairs = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) pairs.set(s.slice(i, i + 2), (pairs.get(s.slice(i, i + 2)) ?? 0) + 1)
  return pairs
}

// 2つの文が共有する組の割合(0〜1)。
const likeness = (a: Map<string, number>, b: Map<string, number>) => {
  let shared = 0
  let total = 0
  for (const [pair, n] of a) {
    shared += Math.min(n, b.get(pair) ?? 0)
    total += n
  }
  for (const n of b.values()) total += n
  return total === 0 ? 0 : (2 * shared) / total
}

// 要約が元の文を言い換えたと見なす近さの下限。
const LIKENESS = 0.3

// 押された行が指すターン。ツールの行は呼び出しの id で探す。要約の行は、要約
// の書き出しを含む thinking を探し、無ければ要約に一番近い途中の発言か thinking
// (本体は言い換えて要約する)。`key` はペインでその途中経過を描く要素。
type Target = { ids: string[] } | { thought: string }

export const turnOf = (list: readonly Turn[], target: Target): { at: number; step: number; key: string } | null => {
  let hits: (s: Step) => boolean
  if ('thought' in target) {
    // 本体は要約を描く前に整形するので、書き出しの一部で照らし合わせる。
    const head = squash(target.thought).slice(0, 60)
    if (head === '') return null
    hits = s => s.kind === 'thinking' && squash(s.text).includes(head)
  } else hits = s => s.kind === 'call' && target.ids.includes(s.call.id)
  for (const [at, turn] of list.entries()) {
    const i = turn.steps.findIndex(hits)
    if (i >= 0) return { at, step: i, key: stepKey(at, i) }
  }
  if (!('thought' in target)) return null
  const summary = pairsOf(target.thought)
  let best: { at: number; step: number; key: string } | null = null
  let score = LIKENESS
  for (const [at, turn] of list.entries())
    for (const [i, s] of turn.steps.entries()) {
      if ((s.kind !== 'text' && s.kind !== 'thinking') || i === turn.reply) continue
      const near = likeness(summary, pairsOf(s.text))
      if (near >= score) [best, score] = [{ at, step: i, key: stepKey(at, i) }, near]
    }
  return best
}

async function conversation($: any, agent: string | null): Promise<Turn[] | null> {
  try {
    const r = await $.session.messages(agent === null ? { as: 'api' } : { agentId: agent, as: 'api' })
    return Array.isArray(r) ? turnsOf(r) : null
  } catch {
    return null
  }
}

// 途中の発言、最後の発言、ツール呼び出しを会話から数え直す。変わったら行を描き直
// させる。
async function recount($: any) {
  const list = await conversation($, null)
  if (!list) return
  const found = midsOf(list)
  const answers = finalsOf(list)
  let changed =
    found.length !== mids.length || found.some((m, i) => m !== mids[i]) || answers.length !== finals.length || answers.some((m, i) => m !== finals[i])
  mids = found
  finals = answers
  const ids = list.flatMap(turn => turn.steps.flatMap(s => (s.kind === 'call' ? [s.call.id] : [])))
  changed ||= ids.some(id => !callIds.has(id))
  callIds = new Set([...callIds, ...ids])
  if (changed) await update($, marks, n => n + 1)
}

// 本体の会話から探し、無ければ(サブエージェントの画面で押した)各エージェント
// の会話を探す。
async function locate($: any, target: Target) {
  const main = (await conversation($, null)) ?? []
  const hit = turnOf(main, target)
  if (hit) return { list: main, agent: null as string | null, ...hit }
  const agents: { id: string }[] = await $.agent.list().catch(() => [])
  for (const a of agents) {
    const list = await conversation($, a.id)
    const r = list && turnOf(list, target)
    if (list && r) return { list, agent: a.id as string | null, ...r }
  }
  return null
}

// MARK: 描く範囲

// ペインの置かれ方。本体が幅で決める。fullscreen の 110 列以上では右にドック
// ('dock')し、それより狭いときや fullscreen でない画面ではプロンプトの上
// ('inline')に置く。
type Placement = 'dock' | 'inline'

// 結果と入力を見せる行数。ドックは床から天井まで使えるので長めに見せる。プロン
// プトの上に置かれたペイン(細長いターミナル、fullscreen でない画面)は数行に抑え
// る。
export const limitsOf = (placement: Placement, narrow: boolean) =>
  placement === 'dock' ? { result: narrow ? 12 : 24, input: 16 } : { result: narrow ? 4 : 8, input: 6 }

// ツール呼び出しの、見出しの下に出し入れする部分。
type Segment = 'input' | 'result'
const segmentOf = (t: number, i: number, s: Segment) => `${t}:${i}:${s}`
const isOut = (v: View, t: number, i: number, s: Segment) => (v.segments ?? []).includes(segmentOf(t, i, s))

export const clip = (text: string, chars: number) => (text.length <= chars ? text : `${text.slice(0, Math.max(0, chars - 1))}…`)

// 先頭から `max` 行と、残りの行数。
export const headLines = (text: string, max: number) => {
  const all = clip(text, MAX_CHARS).replace(/\s+$/, '').split('\n')
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) }
}

// 1ページは、Claude の発言から次の発言までの途中経過(thinking とツール呼び出
// し)。発言はトランスクリプトに出るので、それを区切りにする。ターンの最初のペ
// ージはプロンプトから始まり、最後の発言の後にまだ続いている分(実行中のターン)
// は終わりの発言の無いページになる。`before` と `after` は区切りの発言の steps
// での位置(無ければ -1)。
export type Page = { turn: number; before: number; steps: number[]; after: number }

export const pagesOf = (list: readonly Turn[]): Page[] => {
  const out: Page[] = []
  for (const [t, turn] of list.entries()) {
    let page: Page = { turn: t, before: -1, steps: [], after: -1 }
    for (const [i, s] of turn.steps.entries()) {
      if (s.kind !== 'text') {
        page.steps.push(i)
        continue
      }
      out.push({ ...page, after: i })
      page = { turn: t, before: i, steps: [], after: -1 }
    }
    // 発言で終わったターンには、その後に空のページを作らない。
    if (page.steps.length > 0 || page.before < 0) out.push(page)
  }
  return out
}

// ターン t の steps の i 番目を描くページ。発言は、それに続く途中経過のページ。
// ターンの最後の発言は、それで終わるページ。
export const pageOf = (pages: readonly Page[], t: number, i: number) => {
  const at = pages.findIndex(p => p.turn === t && (p.before === i || p.steps.includes(i)))
  return at >= 0 ? at : pages.findIndex(p => p.turn === t && p.after === i)
}

// 見ているページの位置。
const pageAt = (v: View, total: number) => (v.at === null || v.at === undefined ? total - 1 : Math.min(v.at, total - 1))

// MARK: ペインの操作

// ドックのときに希望する幅と、プロンプトの上に置かれるときに希望する高さ。細長
// いターミナルでは高さの半分弱、広いものでは横幅の4割弱。
export const dockColumns = (columns: number) => Math.max(36, Math.min(72, Math.round(columns * 0.38)))
export const inlineRows = (rows: number) => Math.max(8, Math.min(24, Math.round(rows * 0.45)))

async function isUp($: any) {
  const panes: { id: string }[] = await $.ui.panes().catch(() => [])
  return panes.some(p => p.id === PANE)
}

// fullscreen 表示で、本体がペインを右にドックする幅。これより狭いと本体はプロ
// ンプトの上に置くので、ペインはそこには出さない(fullscreen でない画面ではドッ
// クできないので、プロンプトの上に置く)。
const DOCK_FLOOR = 110
const cramped = () => terminal.fullscreen === true && terminal.columns < DOCK_FLOOR
const WAITING = `peek: opens on the right once the terminal is ${DOCK_FLOOR} columns wide`

const paneArgs = () => ({
  id: PANE,
  title: 'Peek',
  focus: true,
  closeOnEscape: true,
  columns: dockColumns(terminal.columns),
  rows: inlineRows(terminal.rows),
})

// 本人の操作から開いたペインは、本体が幅を問わず置く(狭ければプロンプトの上)。
// 操作の外から開けば、本体は狭い間は描かずに待たせ、ターミナルが広がったら右
// にドックする。押したときの `$` からは時計で遅らせても操作の内なので、行を描き
// 直させ、描くときの `$` から開く。
let openOnDraw = false
const openLater = ($: any) => {
  openOnDraw = true
  $.ui.invalidate('ui.render')
}
const measured = ($: any, viewport: Parameters<typeof remember>[0]) => {
  remember(viewport)
  if (!openOnDraw) return
  openOnDraw = false
  void $.ui.open(paneArgs()).catch(() => undefined)
}

// ドックしていたペインが、ターミナルが狭まってプロンプトの上に移されたら、閉じ
// て操作の外から開き直し、広がるまで待たせる。閉じる間は開いている状態のままに
// する。
let parking = false
// 最後にドックして描いたときのスクロール位置。
let dockOffset = 0
// 待たせたペインが右に置かれたら見せる所。待たせる前のスクロール位置か、狭い
// 間に押された行。
let onDock: number | Reveal[] | null = null
// 次の `ui.scroll` で移す先。本体のスクロールの呼び出しは要素か端しか指せない
// ので、端へ送る途中で行き先を書き換える。
let scrollTo: number | null = null
function park($: any) {
  if (parking) return
  parking = true
  onDock ??= dockOffset
  $.ui.toast(WAITING)
  void (async () => {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    await $.ui.open(paneArgs()).catch(() => undefined)
    parking = false
  })()
}

type Reveal = 'start' | { key: string; block: 'start' | 'center' | 'end' | 'nearest' }
// ページの末尾に置く目印。末尾についていくときは、本体の `end`(伸びるのに本体が
// 黙ってついていく)ではなく、この目印まで送る。本体が描き直しを頼まずに動かすと、
// 上下に留めた見出しとボタンの位置がずれるため。
const END = 'peek-end'
const toEnd: Reveal = { key: END, block: 'end' }

// 最後に描いたペインが、見出しと下のボタンを見せている行の上下に留めているか。
let pinnedPane = false
// 本体がこれから窓を動かす先。ホイールでは、本体は窓を動かして古い描画のまま一
// 度描き、それから描き直しを頼むので、留めたものが一瞬ずれてちらつく。動かす前に
// 動かす先で描いておき、描き直しが届いたら本体の位置に戻す。
let ahead: number | null = null

// 描き直した後のペインで、見せたい所までスクロールする。キーで指す要素はまだ描
// かれていないことがあるので、少し待って数回試す。
async function reveal($: any, to: Reveal) {
  const args = typeof to === 'string' ? { in: PANE, to } : { in: PANE, to: { key: to.key }, block: to.block }
  for (let tries = 0; tries < 5; tries++) {
    const r = await $.ui.scroll(args).catch(() => ({ deny: 'failed' }))
    if (!r || !('deny' in r)) return
    if (!(await $.clock.sleep(60).then(() => true, () => false))) return
  }
}

const redraw = ($: any) => update($, pane, v => ({ ...v, version: v.version + 1 }))

// 開いて、今描かれたか。狭い間は待たせ、右に置かれたら `to` を見せる。
async function openPane($: any, to: Reveal[]) {
  if (cramped()) {
    // 待っているペインを本人の操作から開き直すと、プロンプトの上に置かれる。
    if (!(await isUp($))) openLater($)
    onDock = to
    $.ui.toast(WAITING)
    return false
  }
  const opened = await $.ui.open(paneArgs())
  if (!opened.isPlaced) $.ui.toast(`peek: ${opened.reason}`)
  return true
}

// 会話を読み込んで開き、順に見せたい所までスクロールする。
async function show($: any, list: Turn[], agent: string | null, patch: Partial<View>, to: Reveal[]) {
  turns = list
  agentId = agent
  await update($, pane, v => ({ ...v, open: true, total: pagesOf(list).length, note: null, ...patch, version: v.version + 1 }))
  if (await openPane($, to)) void revealAll($, to)
}

const revealAll = async ($: any, to: Reveal[]) => {
  for (const r of to) await reveal($, r)
}

const NOT_YET = 'Not in the conversation yet (still running, or compacted): showing what the row holds.'

// 押された行の途中経過を含むページ(直前の Claude の発言から直後の発言まで)を開
// く。上にはそのターンのプロンプトがあるので、ページの頭から見せ、押された呼び
// 出しか thinking が見えるまでスクロールする。呼び出しは入力と結果も見せる。同
// じ行をもう一度押したら閉じる。会話に見つからない(圧縮された、まだ記録されて
// いない)ときは、行が持っている分だけを末尾に足して見せる。
async function openAt($: any, target: Target, drawn: Turn) {
  const hit = await locate($, target)
  const v = await read($, pane)
  if (hit && v.open && v.target === hit.key && agentId === hit.agent && (await isUp($))) {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return
  }
  let found = hit
  if (!found) {
    const list = [...((await conversation($, null)) ?? []), drawn]
    found = { list, agent: null, at: list.length - 1, step: 0, key: stepKey(list.length - 1, 0) }
  }
  const step = found.list[found.at]?.steps[found.step]
  const segments = [
    ...(found.agent === agentId ? (v.segments ?? []) : []),
    ...(step?.kind === 'call' ? [segmentOf(found.at, found.step, 'input'), segmentOf(found.at, found.step, 'result')] : []),
  ]
  await show(
    $,
    found.list,
    found.agent,
    {
      at: Math.max(0, pageOf(pagesOf(found.list), found.at, found.step)),
      segments: [...new Set(segments)],
      follow: false,
      prompt: false,
      target: found.key,
      note: hit ? null : NOT_YET,
    },
    ['start', { key: found.key, block: 'center' }],
  )
}

// トランスクリプトの詳しさを変える。ストアに覚え、描いてある行を描き直させる。
async function setLevel($: any, to: Level) {
  level = to
  await $.store.set(LEVEL_KEY, to).catch(() => undefined)
  await update($, marks, n => n + 1)
  $.ui.invalidate('ui.render')
}

// `/peek`。閉じていれば最新のページで開き、開いていれば閉じる。
async function toggle($: any) {
  if (await isUp($)) {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return
  }
  const v = await read($, pane)
  const segments = agentId === null ? (v.segments ?? []) : []
  await show($, (await conversation($, null)) ?? [], null, { at: null, follow: true, prompt: false, target: null, segments }, ['start'])
}

// ページを移り、その頭(プロンプト)から見せる。最後のページに来たら、会話が進
// むのについていく。
async function go($: any, at: number) {
  const last = pagesOf(turns).length - 1
  const to = Math.max(0, Math.min(last, at))
  await update($, pane, (v): View => ({ ...v, at: to === last ? null : to, follow: to === last, prompt: false, version: v.version + 1 }))
  void reveal($, 'start')
}

const latest = ($: any) => go($, Number.MAX_SAFE_INTEGER)

// ツール呼び出しの入力や結果を見せる・隠す。1つでも隠れていればすべて見せ、す
// べて見えていればすべて隠す。読んでいる所に留まるよう、末尾へは送らなくする。
async function toggleSegments($: any, t: number, i: number, which: readonly Segment[]) {
  await update($, pane, v => {
    const ids = which.map(s => segmentOf(t, i, s))
    const shown = v.segments ?? []
    const segments = ids.every(id => shown.includes(id)) ? shown.filter(id => !ids.includes(id)) : [...new Set([...shown, ...ids])]
    return { ...v, segments, follow: false, version: v.version + 1 }
  })
  void reveal($, { key: stepKey(t, i), block: 'nearest' })
  void settle($)
}

async function togglePrompt($: any) {
  await update($, pane, v => ({ ...v, prompt: !v.prompt, version: v.version + 1 }))
  void settle($)
}

// 開いている間、会話を読み直す。最新のページを見ていれば、新しいページに移った
// らその頭から、同じページが伸びたら末尾までスクロールしていればその末尾を見せ
// る。
async function reload($: any) {
  if (!(await read($, pane)).open) return
  const list = await conversation($, agentId)
  if (!list) return
  const before = pagesOf(turns).length
  turns = list
  const total = pagesOf(list).length
  const v = await update($, pane, v => ({ ...v, total, note: null, version: v.version + 1 }))
  if (v.at !== null && v.at !== undefined) return
  if (total !== before) void reveal($, 'start')
  void settle($, total === before && v.follow)
}

// 少し後に、伸びたページの末尾へ送り(`follow`)、ペインを描き直して、上下に留めた
// ものを今の位置に合わせる。描き直す前に送ると伸びる前の末尾で止まり、中身が縮ん
// で本体が見せる行を詰めたときは本体が描き直しを頼まないため。
async function settle($: any, follow = false) {
  if (!(await $.clock.sleep(150).then(() => true, () => false))) return
  const v = await read($, pane)
  if (!v.open) return
  if (follow && v.follow && (v.at === null || v.at === undefined)) await reveal($, toEnd)
  await redraw($)
}

// MARK: 行の見た目

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// シェルのコマンドを、コマンドの名前とそれを繋ぐ記号(`&&`、`||`、`|`、`;`、
// `&`)だけにする。引数は `..` にまとめ、パスで書いた名前はファイル名にする。
// 引用符、`$(…)`、ヒアドキュメントの中とコメントは見ない。改行は `;` と同じ。
// `then` などの予約語は、続くコマンドの名前の前に残す。
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

export const shellOutline = (command: string): string => {
  const parts: string[] = []
  let words: string[] = []
  let word = ''
  let opens = 0
  const heredocs: string[] = []
  const endWord = () => {
    if (word !== '') words.push(word)
    word = ''
  }
  const endCommand = () => {
    endWord()
    const lead: string[] = []
    let at = 0
    while (at < words.length && (KEYWORDS.has(words[at]!) || ASSIGNMENT.test(words[at]!))) {
      if (KEYWORDS.has(words[at]!)) lead.push(words[at]!)
      at++
    }
    const name = words[at]?.replace(/^(['"])(.*)\1$/, '$2')
    if (name !== undefined) {
      const short = /\/[^/]+$/.test(name) ? name.slice(name.lastIndexOf('/') + 1) : name
      parts.push(`${'('.repeat(opens)}${[...lead, short].join(' ')}${at < words.length - 1 ? ' ..' : ''}`)
      opens = 0
    } else if (lead.length > 0) parts.push(lead.join(' '))
    words = []
  }
  const op = (text: string) => {
    endCommand()
    const last = parts.at(-1)
    if (last === undefined || /^(&&|\|\||\||;|&)$/.test(last)) return
    parts.push(text)
  }
  const s = command
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    const two = s.slice(i, i + 2)
    if (c === '\\') {
      if (s[i + 1] !== '\n') word += two
      i += 2
    } else if (c === "'" || c === '`') {
      const j = s.indexOf(c, i + 1)
      const end = j < 0 ? s.length : j + 1
      word += s.slice(i, end)
      i = end
    } else if (c === '"') {
      let j = i + 1
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
      word += s.slice(i, j + 1)
      i = j + 1
    } else if (two === '$(') {
      let depth = 0
      let j = i + 1
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++
        else if (s[j] === ')' && --depth === 0) break
      }
      word += s.slice(i, j + 1)
      i = j + 1
    } else if (c === '#' && word === '') {
      while (i < s.length && s[i] !== '\n') i++
    } else if (c === '\n') {
      op(';')
      i++
      // ヒアドキュメントの本文は、終わりの行まで読み飛ばす。
      while (heredocs.length > 0 && i < s.length) {
        const end = s.indexOf('\n', i)
        const stop = end < 0 ? s.length : end
        if (s.slice(i, stop).trim() === heredocs[0]) heredocs.shift()
        i = stop + 1
      }
    } else if (c === ' ' || c === '\t') {
      endWord()
      i++
    } else if (two === '&&' || two === '||') {
      op(two)
      i += 2
    } else if (c === '|') {
      op('|')
      i += two === '|&' ? 2 : 1
    } else if (c === ';') {
      op(';')
      i += two === ';;' ? 2 : 1
    } else if (c === '&' && s[i + 1] !== '>' && !/[<>]$/.test(word)) {
      op('&')
      i++
    } else if (c === '(' && word === '') {
      opens++
      i++
    } else if (c === ')') {
      endCommand()
      if (parts.at(-1) === ';') parts.pop()
      if (parts.length > 0) parts[parts.length - 1] += ')'
      i++
    } else if (c === '<' || c === '>') {
      // リダイレクトは引数として数える。`2>` の番号は記号と一緒に。
      if (!/^\d*$/.test(word)) endWord()
      const doc = c === '<' ? /^<<-?[ \t]*(['"]?)([\w.-]+)\1/.exec(s.slice(i)) : null
      if (doc) heredocs.push(doc[2]!)
      const run = doc?.[0] ?? /^[<>&|]+/.exec(s.slice(i))![0]
      word += run
      i += run.length
    } else {
      word += c
      i++
    }
  }
  endCommand()
  while (parts.length > 0 && /^(&&|\|\||\||;)$/.test(parts.at(-1)!)) parts.pop()
  return parts.map((p, n) => (n === 0 || p === ';' ? p : ` ${p}`)).join('')
}

// 要約は短いマークダウン。ボタンの中は Text だけなので、強調とコードの記号を
// 外す。コードの中(グロブの `**` など)は文字のまま残す。
export const plainOf = (markdown: string) =>
  squash(
    markdown
      .split(/(`[^`\n]+`)/)
      .map(part => (/^`[^`\n]+`$/.test(part) ? part.slice(1, -1) : part.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2').replace(/`/g, '')))
      .join(''),
  )

// 端末で2セルの幅を取る文字(CJK、かな、ハングル、全角、絵文字の大半)。
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u

export const cellsOf = (text: string) => {
  let n = 0
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1
  return n
}

// `cells` セルに収まるよう、はみ出す分を … にして切る。`tail` が真なら頭の方を切る。
export const fit = (text: string, cells: number, tail = false) => {
  if (cellsOf(text) <= cells) return text
  const chars = tail ? [...text].reverse() : [...text]
  const kept: string[] = []
  let n = 0
  for (const ch of chars) {
    const w = WIDE.test(ch) ? 2 : 1
    if (n + w > cells - 1) break
    kept.push(ch)
    n += w
  }
  return tail ? `…${kept.reverse().join('')}` : `${kept.join('')}…`
}

// ツールが返した結果のオブジェクトを文字列にする。行が持っているだけのもの(ま
// だ会話に無い呼び出し)に使う。
export const outputText = (output: unknown): string => {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  if (typeof output !== 'object') return String(output)
  const o = output as Record<string, unknown>
  if (typeof o.stdout === 'string' || typeof o.stderr === 'string')
    return [o.stdout, o.stderr].filter(x => typeof x === 'string' && x !== '').join('\n')
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

// 入力のうち、呼び出しが何に対するものかを表す欄。分かりやすいものから。
const SUBJECT_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'path', 'action', 'prompt']
// パスの欄。切るときはファイル名の残る頭の方を切る。
const PATH_KEYS = ['file_path', 'notebook_path', 'path']

const subjectKeyOf = (input: unknown) => {
  if (typeof input !== 'object' || input === null) return undefined
  const fields = input as Record<string, unknown>
  return SUBJECT_KEYS.find(name => typeof fields[name] === 'string' && fields[name] !== '')
}

export const subjectOf = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  const key = subjectKeyOf(input)
  const raw = key !== undefined ? String(fields[key]) : Object.keys(fields).length > 0 ? JSON.stringify(fields) : ''
  return clip(squash(raw), MAX_SUBJECT)
}

// 見出しの1行で言い尽くせない入力(欄が複数、または複数行)は、本文に JSON で
// 見せる。
export const detailOf = (input: unknown): string | null => {
  if (typeof input !== 'object' || input === null) return null
  const fields = input as Record<string, unknown>
  const multiline = Object.values(fields).some(x => typeof x === 'string' && x.includes('\n'))
  if (Object.keys(fields).length <= 1 && !multiline) return null
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return null
  }
}

// 1行に畳んだツールの行の後ろに添える、隠した結果のブロックが言っていたこと。
type ToolRow = { isErrored: boolean; isInterrupted: boolean; output?: unknown }

const field = (row: ToolRow, name: string): unknown =>
  typeof row.output === 'object' && row.output !== null ? (row.output as Record<string, unknown>)[name] : undefined

export const metaOf = (row: ToolRow) =>
  [
    row.isInterrupted ? 'interrupted' : row.isErrored ? 'error' : '',
    field(row, 'backgroundTaskId') !== undefined ? 'background' : '',
    field(row, 'timedOutAfterMs') !== undefined ? 'timed out' : '',
    typeof field(row, 'returnCodeInterpretation') === 'string' ? String(field(row, 'returnCodeInterpretation')) : '',
  ]
    .filter(Boolean)
    .join(', ')

// 1行に畳んだツールの行の文。道具の名前と後ろの注記は残し、引数を幅に合わせ
// て切る。シェルのコマンドは名前と繋ぎの記号だけにする。
export const toolLine = (tool: string, input: unknown, meta: string, columns: number) => {
  const frame = cellsOf(tool) + 2 + (meta === '' ? 0 : cellsOf(meta) + 3) + 3
  const key = subjectKeyOf(input)
  const command = key === 'command' ? shellOutline(String((input as Record<string, unknown>).command)) : ''
  const subject = command !== '' ? command : subjectOf(input)
  return `(${fit(subject, Math.max(10, columns - GUTTER - 2 - frame), PATH_KEYS.includes(key ?? ''))})`
}

// トランスクリプトの詳しさを選ぶボタンの並び(`show  all  no tools  answers`)。
// ブロックの最後の行の右端に置く。今の段階はブロックの縦線の色で塗り、他は指を
// 載せると明るくする。押すと、トランスクリプト全体がその段階になる。
function drawLevels($: any, e: any, bg: string, accent: string) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const sh = shades()
  const narrow = (e.viewport?.columns ?? terminal.columns) < 50
  return (
    <Box key="peek-levels" flexDirection="row" justifyContent="flex-end">
      {narrow ? null : (
        <Text backgroundColor={bg} dimColor>
          {'show '}
        </Text>
      )}
      {([1, 2, 3] as const).map(n => {
        const name = ` ${narrow ? LEVEL_NAMES[n].narrow : LEVEL_NAMES[n].wide} `
        return (
          <Box key={`peek-level-${n}-box`} flexShrink={0}>
            <Button key={`peek-level-${n}`} plain onPress={() => setLevel($, n)}>
              {n === level ? (
              <Text key={`peek-level-${n}-name`} backgroundColor={accent} color={sh.chip} bold>
                {name}
              </Text>
            ) : (
              <Text key={`peek-level-${n}-name`} backgroundColor={bg} dimColor hover={{ backgroundColor: sh.hover }}>
                {name}
              </Text>
            )}
            </Button>
          </Box>
        )
      })}
    </Box>
  )
}

// MARK: ペインの中身

// 描く所とその幅。
type Site = { placement: Placement; columns: number }
// ペインの枠線と、その内側の左右の余白が取る列数。
const FRAME = 4

// 見出し(ページの位置、前後のページ、最新、読み直し、閉じる)と、見ているページ、
// その下の前後のページへのボタン。スクロールは本体に任せ、見出しと下のボタンは、
// 本体が今見せている行(`scroll.offset` から `scroll.bodyRows` 行)の上端と下端に重
// ねて描き、スクロールしても動かないようにする。右にドックしたペインは、本体が左
// に縦線を引くだけなので、トランスクリプトや他のペインと見分けられるよう、見せて
// いる行の全体を色付きの角丸の枠線で囲む。プロンプトの上のペインは本体が枠で囲む
// ので、枠は描かない。
function drawPane($: any, e: any, v: View, frame: Site, scroll: { offset: number; bodyRows: number }) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const rows = scroll.bodyRows
  // 見出しと下のボタンを重ねても中身が見える高さがあるときだけ、上下に留める。
  const pinned = rows >= 6
  pinnedPane = pinned
  const framed = pinned && frame.placement === 'dock'
  const site = framed ? { ...frame, columns: Math.max(10, frame.columns - FRAME) } : frame
  const narrow = site.columns < NARROW
  const pages = pagesOf(turns)
  const at = pageAt(v, pages.length)
  const page = pages[at]
  const mine = page ? pages.filter(p => p.turn === page.turn) : []
  const k = page ? mine.indexOf(page) + 1 : 0
  const sh = shades()
  // 見出しのボタンの分を残して、タイトルを1行に収める。
  const title = !page
    ? ''
    : site.columns >= 60
      ? `Turn ${page.turn + 1}/${turns.length} · page ${k}/${mine.length}`
      : narrow
        ? `${page.turn + 1}·${k}/${mine.length}`
        : `Turn ${page.turn + 1} · ${k}/${mine.length}`
  // 本体の枠の ✕ は1文字で押しにくいので、見出しにも大きめの閉じるボタンを置く。
  // 右上に ✕ が2つ並ばないよう、こちらは文字だけにする。
  const close = isLightTheme ? CLOSE.light : CLOSE.dark

  const nav = (key: string, hotkey: string, icon: string, on: boolean, press: () => Promise<void>) => (
    <Button key={key} plain hotkey={hotkey} onPress={press}>
      <Text bold dimColor={!on}>{` ${icon} `}</Text>
    </Button>
  )
  const pager = (key: string, label: string, on: boolean, press: () => Promise<void>) => (
    <Button key={key} plain onPress={press}>
      <Text dimColor={!on}>{label}</Text>
    </Button>
  )

  const navs = [
    nav('peek-prev', 'p', '◂', at > 0, () => go($, at - 1)),
    nav('peek-next', 'n', '▸', at < pages.length - 1, () => go($, at + 1)),
    nav('peek-latest', 'e', I.latest, at < pages.length - 1, () => latest($)),
    nav('peek-reload', 'r', I.reload, true, () => reload($)),
    <Box key="peek-close-chip" flexShrink={0}>
      <Button key="peek-close" plain hotkey="x" onPress={() => $.ui.close({ id: PANE })}>
        <Text bold backgroundColor={close.bg} hover={{ backgroundColor: close.hover }}>
          {site.columns >= 74 ? '  close  ' : ' close '}
        </Text>
      </Button>
    </Box>,
  ]
  const head = (
    <Box key="peek-head" flexDirection="row" columnGap={1}>
      <Box key="peek-pos" flexShrink={1}>
        <Text bold wrap="truncate-end">
          {title}
        </Text>
      </Box>
      <Box key="peek-gap" flexGrow={1} />
      {navs}
    </Box>
  )
  const foot =
    pages.length > 1 ? (
      <Box key="peek-pager" flexDirection="row">
        {pager('peek-prev-foot', narrow ? '◂' : '◂ previous', at > 0, () => go($, at - 1))}
        <Box key="peek-pager-gap" flexGrow={1} />
        {pager('peek-next-foot', narrow ? '▸' : 'next ▸', at < pages.length - 1, () => go($, at + 1))}
      </Box>
    ) : null
  const body = [
    agentId ? (
      <Box key="peek-agent">
        <Text dimColor wrap="truncate-end">{`agent ${agentId}`}</Text>
      </Box>
    ) : null,
    v.note ? (
      <Box key="peek-note">
        <Text dimColor italic>
          {v.note}
        </Text>
      </Box>
    ) : null,
    page ? (
      drawPage($, e, v, site, pages, at, pinned ? 0 : 1)
    ) : (
      <Box key="peek-empty">
        <Text dimColor>Nothing said yet. Your prompts and what Claude does show here as the conversation runs.</Text>
      </Box>
    ),
  ]

  if (!pinned)
    return (
      <Box key="peek" flexDirection="column">
        {head}
        {body}
        {foot ? (
          <Box key="peek-foot" marginTop={1}>
            {foot}
          </Box>
        ) : null}
        <Box key={END} height={1} flexShrink={0} />
      </Box>
    )

  // 中身は、上下の1行(見出しと下のボタン、または枠)の下に隠れないよう、上は1行
  // 空け、末尾には1行の目印を置く。重ねるものは中身の後に置き、その上に描かせる。
  // 本体が動かす前に、動かす先で描く。描き直しがその位置で届いたら本体に戻す。
  const top = ahead ?? scroll.offset
  if (ahead === scroll.offset) ahead = null
  const content = [body, <Box key={END} height={1} flexShrink={0} />]
  if (!framed)
    return (
      <Box key="peek" flexDirection="column" paddingTop={1} minHeight={rows}>
        {content}
        <Box key="peek-head-bar" position="absolute" top={top} left={0} right={0} backgroundColor={sh.head}>
          {head}
        </Box>
        {foot ? (
          <Box key="peek-foot-bar" position="absolute" top={top + rows - 1} left={0} right={0} backgroundColor={sh.head}>
            {foot}
          </Box>
        ) : null}
      </Box>
    )

  // 右にドックしたペインは、見せている行の全体を枠で囲み、見出しを枠の上の辺に、
  // 前後のページへのボタンを下の辺に埋め込んで、間の行をすべて中身に使う。枠は
  // 上下左右の4本に分けて重ねる。1つの Box で囲むと、その内側を押しても中身ではな
  // く枠が受けてしまうため。
  const w = frame.columns
  const ink = (text: string) => <Text color={sh.frame}>{text}</Text>
  // 辺の残りを埋める線。幅は flex に任せ、はみ出す分は切る。
  const rule = (key: string) => (
    <Box key={key} flexGrow={1} flexShrink={1} width={0} height={1} overflow="hidden">
      {ink('─'.repeat(Math.max(1, w)))}
    </Box>
  )
  const side = (key: string, left: number) => (
    <Box key={key} position="absolute" top={top + 1} left={left} width={1} height={rows - 2}>
      {ink(Array(rows - 2).fill('│').join('\n'))}
    </Box>
  )
  return (
    <Box key="peek" flexDirection="column" paddingX={2} paddingTop={1} minHeight={rows}>
      {content}
      <Box key="peek-frame-top" position="absolute" top={top} left={0} width={w} height={1} flexDirection="row">
        {ink('╭─')}
        <Box key="peek-pos" flexShrink={1}>
          <Text bold wrap="truncate-end">{` ${title} `}</Text>
        </Box>
        {rule('peek-frame-top-rule')}
        {navs}
        {ink('─╮')}
      </Box>
      <Box key="peek-frame-bottom" position="absolute" top={top + rows - 1} left={0} width={w} height={1} flexDirection="row">
        {ink(foot ? '╰─' : '╰')}
        {foot ? pager('peek-prev-foot', narrow ? ' ◂ ' : ' ◂ previous ', at > 0, () => go($, at - 1)) : null}
        {rule('peek-frame-bottom-rule')}
        {foot ? pager('peek-next-foot', narrow ? ' ▸ ' : ' next ▸ ', at < pages.length - 1, () => go($, at + 1)) : null}
        {ink(foot ? '─╯' : '╯')}
      </Box>
      {side('peek-frame-left', 0)}
      {side('peek-frame-right', w - 1)}
    </Box>
  )
}

// 1ページ。上から、そのターンのプロンプト、直前の Claude の発言、途中経過
// (thinking とツール呼び出し)、直後の発言。ツール呼び出しは見出しの行だけを描
// き、入力と結果はそれぞれ押して出す。
function drawPage($: any, e: any, v: View, site: Site, pages: readonly Page[], at: number, gap: number) {
  const { Box, Text, Button, Markdown, Code } = $.ui.resolve(e)
  const narrow = site.columns < NARROW
  const max = limitsOf(site.placement, narrow)
  const sh = shades()
  // プロンプトの上に置かれたペインでは、行を折り返さずに切る。
  const wrap = site.placement === 'inline' ? 'truncate-end' : 'wrap'
  // 入力の JSON は、広さがあるときだけ色付きで描く。
  const code = !narrow && site.placement !== 'inline'
  const indent = 2
  const page = pages[at]!
  const t = page.turn
  const turn = turns[t]!

  // 左に縦線(`quote` の枠)を引いた、背景を塗ったブロック。この枠は上下にも空の
  // 行を取るので、上下のマージンを1行ずつ戻し、前後との間を1行にしてペインの行を
  // 使い切る。
  const gutter = (key: string, color: string, bg: string, children: unknown) => (
    <Box key={key} flexDirection="row" borderStyle="quote" borderColor={color} backgroundColor={bg} paddingX={1} paddingY={1} marginY={-1}>
      {children}
    </Box>
  )

  // 長いプロンプトは頭の数行だけにし、押すと全部見せる。
  const drawPrompt = () => {
    const lines = clip(turn.prompt, MAX_CHARS).split('\n')
    const keep = site.placement === 'dock' ? 6 : 3
    const cut = lines.length > keep
    const bg = sh.prompt
    return gutter(
      `peek-prompt-${t}`,
      sh.user,
      bg,
      <Box key={`peek-prompt-${t}-text`} flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text backgroundColor={bg} bold>
          {(cut && !v.prompt ? lines.slice(0, keep) : lines).join('\n')}
        </Text>
        {cut ? (
          <Button key="peek-prompt-more" plain onPress={() => togglePrompt($)}>
            <Text backgroundColor={bg} dimColor italic>
              {v.prompt ? '▴ less' : `… +${lines.length - keep} lines`}
            </Text>
          </Button>
        ) : null}
      </Box>,
    )
  }

  // Claude の発言。ターンの最後の発言は Claude の色を薄く敷き、後に途中経過が続
  // く発言は灰色にする。
  const said = (i: number) => {
    const key = stepKey(t, i)
    const step = turn.steps[i]
    if (step?.kind !== 'text') return null
    const bg = i === turn.steps.length - 1 ? sh.reply : sh.message
    return gutter(
      key,
      sh.claude,
      bg,
      <Box key={`${key}-text`} flexDirection="column" flexShrink={1} flexGrow={1}>
        <Markdown text={clip(step.text, MAX_CHARS)} />
      </Box>,
    )
  }

  // 背景を塗った行の並び。最後に残りの行数を添える。
  const block = (key: string, bg: string, lines: { lines: string[]; more: number }, color?: string) => (
    <Box key={key} flexDirection="column" backgroundColor={bg} paddingX={1} marginLeft={2}>
      {lines.lines.map((line, n) => (
        <Text key={`${key}-${n}`} backgroundColor={bg} color={color} wrap={wrap}>
          {line === '' ? ' ' : line}
        </Text>
      ))}
      {lines.more > 0 ? (
        <Text backgroundColor={bg} dimColor italic>
          {`… +${lines.more} lines`}
        </Text>
      ) : null}
    </Box>
  )

  const drawCall = (c: Call, t: number, i: number, key: string) => {
    const detail = detailOf(c.input)
    const parts: Segment[] = detail ? ['input', 'result'] : ['result']
    const showIn = detail !== null && isOut(v, t, i, 'input')
    const showOut = isOut(v, t, i, 'result')
    const text = c.result === null ? null : c.result.replace(/\s+$/, '')
    const count = text === null ? null : text === '' ? 0 : text.split('\n').length
    const dot = c.result === null ? 'warning' : c.isError ? 'error' : 'success'
    const outLabel = count === null ? (narrow ? '…' : 'running…') : narrow ? `⎿${count}` : count === 0 ? 'no output' : plural(count, 'line', 'lines')
    const inLabel = narrow ? '{}' : 'input'
    // 見出しは1行に収める。パスはファイル名が残るよう頭の方を切る。
    const chips = (detail ? cellsOf(` ▸ ${inLabel} `) : 0) + cellsOf(` ▸ ${outLabel} `)
    const room = site.columns - indent - 2 - cellsOf(c.tool) - 1 - chips
    const subject = fit(subjectOf(c.input), Math.max(8, room), PATH_KEYS.includes(subjectKeyOf(c.input) ?? ''))
    const chip = (s: Segment, label: string, on: boolean, color?: string) => (
      <Box key={`${key}-chip-${s}`} flexShrink={0}>
        <Button key={`peek-seg-${t}-${i}-${s}`} plain onPress={() => toggleSegments($, t, i, [s])}>
          <Text backgroundColor={sh.head} color={color} dimColor={!on && !color}>{` ${on ? '▾' : '▸'} ${label} `}</Text>
        </Button>
      </Box>
    )
    const outBg = c.isError ? sh.error : sh.result
    return (
      <Box key={key} flexDirection="column">
        <Box key={`${key}-head`} flexDirection="row" backgroundColor={sh.head}>
          <Box key={`${key}-dot`} minWidth={2} flexShrink={0}>
            <Text backgroundColor={sh.head} color={dot}>
              ●
            </Text>
          </Box>
          <Box key={`${key}-name`} flexShrink={1} flexGrow={1}>
            <Button key={`peek-call-${t}-${i}`} plain onPress={() => toggleSegments($, t, i, parts)}>
              <Text backgroundColor={sh.head} wrap="truncate-end">
                <Text bold>{c.tool}</Text>
                <Text dimColor>{` ${subject}`}</Text>
              </Text>
            </Button>
          </Box>
          {detail ? chip('input', inLabel, showIn) : null}
          {chip('result', outLabel, showOut, c.isError ? 'error' : undefined)}
        </Box>
        {showIn && detail ? (
          code ? (
            <Box key={`${key}-input`} flexDirection="column" backgroundColor={sh.input} paddingX={1} marginLeft={2}>
              <Code language="json" source={headLines(detail, max.input).lines.join('\n')} />
            </Box>
          ) : (
            block(`${key}-input`, sh.input, headLines(detail, max.input))
          )
        ) : null}
        {showOut
          ? text === null
            ? block(`${key}-out`, outBg, { lines: ['running…'], more: 0 })
            : block(`${key}-out`, outBg, headLines(text === '' ? '(no output)' : text, max.result), c.isError ? 'error' : undefined)
          : null}
      </Box>
    )
  }

  const drawStep = (step: Step, i: number) => {
    const key = stepKey(t, i)
    if (step.kind === 'call') return drawCall(step.call, t, i, key)
    if (step.kind === 'text') return said(i)
    if (step.kind === 'redacted')
      return (
        <Box key={key}>
          <Text dimColor italic>
            ∴ redacted thinking
          </Text>
        </Box>
      )
    return (
      <Box key={key} flexDirection="row">
        <Box key={`${key}-mark`} minWidth={2} flexShrink={0}>
          <Text dimColor>∴</Text>
        </Box>
        <Box key={`${key}-text`} flexDirection="column" flexShrink={1} flexGrow={1}>
          {step.text === '' ? (
            <Text dimColor italic>
              (thinking not returned by the API)
            </Text>
          ) : (
            <Markdown dimColor text={clip(step.text, MAX_CHARS)} />
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box key={`peek-page-${at}`} flexDirection="column" rowGap={1} marginTop={gap}>
      {turn.prompt !== '' ? drawPrompt() : null}
      {page.before >= 0 ? said(page.before) : null}
      {page.steps.length > 0 ? (
        <Box key="peek-steps" flexDirection="column" rowGap={1} marginLeft={indent}>
          {page.steps.map(i => drawStep(turn.steps[i]!, i))}
        </Box>
      ) : null}
      {page.after >= 0 ? said(page.after) : null}
    </Box>
  )
}

const remember = (viewport: { columns: number; rows: number; isFullscreen?: boolean } | undefined) => {
  if (viewport) terminal = { columns: viewport.columns, rows: viewport.rows, fullscreen: viewport.isFullscreen ?? terminal.fullscreen }
}

// MARK: フック

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: PANE,
        description:
          'Read the conversation in a pane a page at a time: under your prompt, what Claude did between two of its messages. `/peek 1|2|3` sets how much the transcript shows',
        argumentHint: '[1|2|3]',
        immediate: true,
      })
      .catch(() => undefined)
    const stored = await $.store.get(LEVEL_KEY).catch(() => undefined)
    level = stored === 1 || stored === 2 || stored === 3 ? stored : (await $.store.get(COMPACT_KEY).catch(() => undefined)) === true ? 3 : 1
    const rows = await $.config.list().catch(() => [])
    isLightTheme = lightOf(rows.find(row => row.key === 'theme')?.value)
    // モジュールが読み直されたときは、描いてある行も描き直させる。
    void recount($)
      .then(() => $.ui.invalidate('ui.render'))
      .catch(() => undefined)
    // モジュールが読み直されたときは、開いていた会話を読み直して描き直す。前の
    // 版で帯に開いていたものはペインに開く。
    if ((await read($, pane)).open) {
      if (!(await isUp($))) await openPane($, [])
      await reload($)
    }
    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.deny) {
      isLightTheme = lightOf(r.value)
      $.ui.invalidate('ui.render')
    }
    return r
  })

  on('command.run', { command: PANE }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '1' || arg === '2' || arg === '3') {
      await setLevel($, Number(arg) as Level)
      return { text: LEVELS[level] }
    }
    if (e.presentation) terminal = { ...terminal, columns: e.presentation.columns, fullscreen: e.presentation.isFullscreen }
    await toggle($)
    return {}
  })

  // ペインを閉じたら(✕、ctrl+x x、Esc)、開いていない状態に戻す。広がるまで待た
  // せるために閉じるときはそのまま。
  // 本人が手で閉じたものは、こちらの閉じる処理として閉じ直す。本体は手で閉じら
  // れたペインを、操作の外から開いたときに 144 列になるまで置かないので、狭い間
  // に押して待たせたペインが 110 列で右に出なくなるため。
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin?.kind === 'person') {
      void $.ui.close({ id: PANE }).catch(() => undefined)
      return { value: undefined }
    }
    const r = await next(e)
    if (e.id === PANE && !parking) {
      onDock = null
      await update($, pane, v => ({ ...v, open: false }))
    }
    return r
  })

  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (scrollTo !== null && e.origin?.kind !== 'person') {
      e = { ...e, offset: scrollTo }
      scrollTo = null
    }
    if (pinnedPane) {
      ahead = e.offset
      await redraw($)
    }
    const r = await next(e)
    if (r?.deny) ahead = null
    // 本人がペインを末尾までスクロールしたらページが伸びるのについていき、上へ戻
    // したらやめる。
    if (!r?.deny && e.origin?.kind === 'person') {
      const v = await read($, pane)
      const follow = (v.at === null || v.at === undefined) && e.offset >= e.contentRows - e.bodyRows
      if (follow !== v.follow) await update($, pane, w => ({ ...w, follow }))
    }
    return r
  })

  // 開いている間は、モデルへの次の依頼(前のツール結果が会話に入った後)と、ター
  // ンの終わりで読み直す。
  // 本体の応答で発言の後にツールの呼び出しが来たら、その発言は途中の発言。応答
  // が届くそばから灰色にする。
  // 応答の前に会話を数え直し、届いた呼び出しはそのそばから隠せるようにする。
  on('turn.step', async function* ($, e, next) {
    if ((e.agentId ?? null) === agentId) void reload($).catch(() => undefined)
    if (e.agentId) return yield* next(e)
    await recount($).catch(() => undefined)
    const blocks = new Map<number, string>()
    let marked = false
    for await (const c of next(e)) {
      if (c.kind === 'text') blocks.set(c.index, (blocks.get(c.index) ?? '') + c.text)
      else if (c.kind === 'tool') {
        let changed = !callIds.has(c.id)
        callIds.add(c.id)
        if (!marked) {
          marked = true
          const spoken = [...blocks.values()].map(squash).filter(s => s !== '' && !mids.includes(s))
          mids = [...mids, ...spoken]
          changed ||= spoken.length > 0
        }
        if (changed) await update($, marks, n => n + 1)
      }
      yield c
    }
  })
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    void reload($).catch(() => undefined)
    if (!e.agentId) {
      const answer = squash(e.answer ?? '')
      if (e.reason === 'answer' && answer !== '' && !finals.includes(answer)) finals = [...finals, answer]
      await recount($).catch(() => undefined)
      await update($, marks, n => n + 1)
    }
    return r
  })

  // プロンプトの行(打ち込んだもの、SDK やリモートから来たもの)は、ctrl+o や
  // --verbose で全部見せているかを知っている。他の人の発言とタスクの通知の行は、
  // 見出しの下に収まるかで変わるので使わない。変わったら、ツールの行を描き直させる。
  // 本人のプロンプトは、左に水色の縦線を引き、青みの灰色の背景に描く。最後の行の
  // 右端に、トランスクリプトの詳しさを選ぶボタンを置く。
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    measured($, e.viewport)
    const own = !e.props.from && !e.props.task
    if (own && e.props.isExpanded !== isExpandedView) {
      isExpandedView = e.props.isExpanded
      $.ui.invalidate('ui.render')
    }
    // 打ち込んだもの。記録が出どころを持つ前の版で保存されたものも含める。
    if (!own || (e.props.origin.kind !== 'composer' && e.props.origin.kind !== 'unclassified')) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    await read($, marks)
    const sh = shades()
    const bg = sh.prompt
    return (
      <Box
        key="peek-gutter"
        flexDirection="column"
        borderStyle="quote"
        borderColor={sh.user}
        backgroundColor={bg}
        paddingX={1}
        paddingTop={1}
        paddingBottom={isExpandedView ? 1 : 0}
      >
        <Text>{e.props.text}</Text>
        {isExpandedView ? null : drawLevels($, e, bg, sh.user)}
      </Box>
    )
  })

  // 1つずつのツールの行(Write、Edit、Bash など)。1行に畳んで押せるようにし、
  // 押すとその呼び出しのターンを開く。2 と 3 では隠す。
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    measured($, e.viewport)
    if (e.surface !== 'terminal' || isExpandedView) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const row = e.props
    await read($, marks)
    if (level >= 2 && callIds.has(row.tool_use_id)) return <Box key="peek-hidden" />
    const meta = metaOf(row)
    const call: Call = {
      id: row.tool_use_id,
      tool: row.tool,
      input: row.input,
      result: row.output === undefined ? null : outputText(row.output),
      isError: row.isErrored || row.isInterrupted,
    }
    // 承認や順番を待つ間も isRunning は false なので、結果が入るまでは実行中の色。
    const dot = row.isErrored || row.isInterrupted ? 'error' : row.isRunning || row.output === undefined ? 'warning' : 'success'
    return (
      <Box key="peek-row" flexDirection="row">
        <Box key="peek-row-dot" minWidth={2} flexShrink={0}>
          <Text color={dot}>●</Text>
        </Box>
        <Button key="peek-open" plain onPress={() => openAt($, { ids: [row.tool_use_id] }, { prompt: '', steps: [{ kind: 'call', call }], reply: -1 })}>
          <Text bold>{row.tool}</Text>
          <Text>{toolLine(row.tool, row.input, meta, e.viewport?.columns ?? terminal.columns)}</Text>
          {meta ? (
            <Text color={row.isErrored ? 'error' : undefined} dimColor={!row.isErrored}>
              {` · ${meta}`}
            </Text>
          ) : null}
          <Text dimColor>{`  ${I.open}`}</Text>
        </Button>
      </Box>
    )
  })

  // 畳んだ行の下の結果のブロック。中身はペインで見る。
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || isExpandedView) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box key="peek-result" />
  })

  // 本体が畳んだツールの行(`Read 3 files, ran 2 shell commands`)。展開して、
  // 呼び出しを1つずつ上の ToolUse の行として描かせる。
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    measured($, e.viewport)
    if (e.surface !== 'terminal' || isExpandedView || e.props.isExpanded) return next(e)
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // Claude の発言は、左に Claude の色の縦線を引いて描く。ターンの最後の発言(答え)
  // は薄い Claude の色、ツール呼び出しの合間の途中の発言は灰色の背景にする。最後
  // の発言には、プロンプトと同じく詳しさを選ぶボタンを置く。要約
  // の行は、点を付けず上下に1行ずつ空けた灰色の帯にする。押すと、要約の元の
  // thinking を含むターンを開く。3 では、途中の発言と要約の行を隠す。
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    measured($, e.viewport)
    if (e.surface !== 'terminal') return next(e)
    await read($, marks)
    const text = e.props.text
    const isFinal = !e.props.isSummary && isMid(finals, text)
    const isStep = !isFinal && !e.props.isSummary && isMid(mids, text)
    if (level >= 3 && !isExpandedView && (e.props.isSummary || isStep)) {
      const { Box } = $.ui.resolve(e)
      return <Box key="peek-hidden" />
    }
    if (!e.props.isSummary) {
      const { Box, Markdown } = $.ui.resolve(e)
      const sh = shades()
      const bg = isFinal ? sh.reply : isStep ? sh.message : undefined
      const controls = isFinal && !isExpandedView
      return (
        <Box
          key="peek-gutter"
          flexDirection="column"
          borderStyle="quote"
          borderColor={sh.claude}
          backgroundColor={bg}
          paddingX={1}
          paddingTop={1}
          paddingBottom={controls ? 0 : 1}
        >
          <Markdown text={text} />
          {controls ? drawLevels($, e, sh.reply, sh.claude) : null}
        </Box>
      )
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const drawn: Turn = { prompt: '', steps: [{ kind: 'thinking', text }], reply: -1 }
    const bg = summaryBg()
    return (
      <Box key="peek-summary" flexDirection="row" marginTop={1} marginBottom={1}>
        <Box key="peek-summary-gutter" minWidth={2} flexShrink={0} />
        <Box key="peek-summary-band" flexGrow={1} paddingX={1} backgroundColor={bg}>
          <Button key="peek-open" plain onPress={() => openAt($, { thought: text }, drawn)}>
            <Text backgroundColor={bg}>{plainOf(text)}</Text>
            <Text backgroundColor={bg} dimColor>{` · summary  ${I.open}`}</Text>
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    measured($, e.viewport)
    if (e.props.placement === 'inline' && cramped()) {
      park($)
      const { Box } = $.ui.resolve(e)
      return <Box key="peek-parked" />
    }
    if (e.props.placement === 'dock') {
      const to = onDock
      onDock = null
      if (typeof to === 'number') {
        scrollTo = to
        void reveal($, 'start')
      } else if (to) void revealAll($, to)
      else dockOffset = e.props.scroll?.offset ?? 0
    }
    return drawPane($, e, await read($, pane), { placement: e.props.placement, columns: e.props.bodyColumns }, e.props.scroll ?? { offset: 0, bodyRows: 0 })
  })
}
