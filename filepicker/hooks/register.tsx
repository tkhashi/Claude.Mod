import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Browser, Entry, Kind, Sort } from '../types'
import { DEVICONS_BY_EXT, DEVICONS_BY_NAME } from './devicons'

// 閉じた状態(ブラウザの初期状態)。選んだ並び順は、開き直しても引き継ぐ。
const closed: Browser = { active: false, dir: '', filter: '', entries: [], error: null, page: 0, sort: 'mtime', kind: 'all', ext: null, preview: false }

// 各並び順の `ls` への頼み方。新しい順、名前順、大きい順。
const SORTS: { sort: Sort; icon: string; label: string; flags: string }[] = [
  { sort: 'mtime', icon: '\uf017', label: 'Modified', flags: '-1Apt' },
  { sort: 'name', icon: '\uf15d', label: 'Name', flags: '-1Ap' },
  { sort: 'size', icon: '\uf160', label: 'Size', flags: '-1ApS' },
]
const KINDS: { kind: Kind; icon: string; label: string }[] = [
  { kind: 'all', icon: '\uf0ca', label: 'All' },
  { kind: 'dirs', icon: '\uf07b', label: 'Folders' },
  { kind: 'files', icon: '\uf15b', label: 'Files' },
]
// これより狭いと、ピッカーは操作ボタンをアイコンだけにし、パンくずを途中で省
// 略する。
const NARROW = 70
// フォルダ内の拡張子のうち、ボタンを出す数。多いものから。
const MAX_EXTS = 6
const browser = atom({ plugin: 'filepicker', key: 'browser' } as const, closed)

// statusbar と同じパレット(Catppuccin Mocha)。2つが1つの帯に見えるようにする。
const C = {
  ink: '#1e1e2e',
  text: '#cdd6f4',
  dim: '#7f849c',
  block: '#45475a',
  blue: '#89b4fa',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  mauve: '#cba6f7',
  teal: '#94e2d5',
  red: '#f38ba8',
  pink: '#f5c2e7',
  sky: '#89dceb',
}

// ファイルの種類ごとのアイコンと色。エディタのファイルツリーと同じ見た目
// (nvim-web-devicons のグリフ、色はこのパレット)。ファイル名全体で先に引き、
// 次に拡張子で引く。どれにも当たらなければ普通のファイル。
type Style = { icon: string; color: string }
const BY_EXT: Record<string, Style> = {
  ts: { icon: '\ue628', color: C.blue },
  mts: { icon: '\ue628', color: C.blue },
  cts: { icon: '\ue628', color: C.blue },
  tsx: { icon: '\ue7ba', color: C.sky },
  jsx: { icon: '\ue7ba', color: C.sky },
  js: { icon: '\ue74e', color: C.yellow },
  mjs: { icon: '\ue74e', color: C.yellow },
  cjs: { icon: '\ue74e', color: C.yellow },
  json: { icon: '\ue60b', color: C.yellow },
  jsonc: { icon: '\ue60b', color: C.yellow },
  md: { icon: '\ue609', color: C.text },
  mdx: { icon: '\ue609', color: C.text },
  py: { icon: '\ue606', color: C.blue },
  ipynb: { icon: '\ue606', color: C.peach },
  html: { icon: '\ue736', color: C.peach },
  htm: { icon: '\ue736', color: C.peach },
  css: { icon: '\ue749', color: C.blue },
  scss: { icon: '\ued49', color: C.pink },
  sass: { icon: '\ued49', color: C.pink },
  rs: { icon: '\ue7a8', color: C.peach },
  go: { icon: '\ue627', color: C.sky },
  yml: { icon: '\ue6a8', color: C.mauve },
  yaml: { icon: '\ue6a8', color: C.mauve },
  toml: { icon: '\ue6b2', color: C.dim },
  lock: { icon: '\uf023', color: C.yellow },
  sh: { icon: '\ue795', color: C.green },
  bash: { icon: '\ue795', color: C.green },
  zsh: { icon: '\ue795', color: C.green },
  fish: { icon: '\ue795', color: C.green },
  png: { icon: '\ue60d', color: C.mauve },
  jpg: { icon: '\ue60d', color: C.mauve },
  jpeg: { icon: '\ue60d', color: C.mauve },
  gif: { icon: '\ue60d', color: C.mauve },
  webp: { icon: '\ue60d', color: C.mauve },
  ico: { icon: '\ue60d', color: C.mauve },
  bmp: { icon: '\ue60d', color: C.mauve },
  svg: { icon: '\ue698', color: C.peach },
  pdf: { icon: '\ueaeb', color: C.red },
  zip: { icon: '\uf410', color: C.yellow },
  gz: { icon: '\uf410', color: C.yellow },
  tgz: { icon: '\uf410', color: C.yellow },
  tar: { icon: '\uf410', color: C.yellow },
  '7z': { icon: '\uf410', color: C.yellow },
  rb: { icon: '\ue791', color: C.red },
  java: { icon: '\ue738', color: C.peach },
  cs: { icon: '\u{f031b}', color: C.mauve },
  csx: { icon: '\u{f031b}', color: C.mauve },
  xaml: { icon: '\u{f0673}', color: C.sky },
  axaml: { icon: '\u{f0673}', color: C.sky },
  sln: { icon: '\u{f0610}', color: C.mauve },
  slnx: { icon: '\u{f0610}', color: C.mauve },
  csproj: { icon: '\u{f0610}', color: C.mauve },
  props: { icon: '\u{f0610}', color: C.dim },
  targets: { icon: '\u{f0610}', color: C.dim },
  resx: { icon: '\ueae9', color: C.dim },
  razor: { icon: '\u{f031b}', color: C.sky },
  kt: { icon: '\ue634', color: C.mauve },
  swift: { icon: '\ue755', color: C.peach },
  c: { icon: '\ue61e', color: C.blue },
  h: { icon: '\ue61e', color: C.mauve },
  cpp: { icon: '\ue61d', color: C.blue },
  cc: { icon: '\ue61d', color: C.blue },
  hpp: { icon: '\ue61d', color: C.mauve },
  lua: { icon: '\ue620', color: C.blue },
  php: { icon: '\ue73d', color: C.mauve },
  vue: { icon: '\ue6a0', color: C.green },
  sql: { icon: '\ue706', color: C.pink },
  db: { icon: '\ue706', color: C.pink },
  sqlite: { icon: '\ue706', color: C.pink },
  csv: { icon: '\uf0ce', color: C.green },
  tsv: { icon: '\uf0ce', color: C.green },
  xlsx: { icon: '\uf0ce', color: C.green },
  txt: { icon: '\uf15c', color: C.text },
  log: { icon: '\uf15c', color: C.dim },
  xml: { icon: '\ueae9', color: C.peach },
  ifc: { icon: '\ueae9', color: C.teal },
  conf: { icon: '\ue615', color: C.dim },
  ini: { icon: '\ue615', color: C.dim },
  cfg: { icon: '\ue615', color: C.dim },
  tf: { icon: '\ue69a', color: C.mauve },
  mp4: { icon: '\uf03d', color: C.pink },
  mov: { icon: '\uf03d', color: C.pink },
  webm: { icon: '\uf03d', color: C.pink },
  mp3: { icon: '\uf001', color: C.teal },
  wav: { icon: '\uf001', color: C.teal },
}
const BY_NAME: Record<string, Style> = {
  dockerfile: { icon: '\uf308', color: C.blue },
  'docker-compose.yml': { icon: '\uf308', color: C.blue },
  'compose.yml': { icon: '\uf308', color: C.blue },
  '.gitignore': { icon: '\uf1d3', color: C.peach },
  '.gitattributes': { icon: '\uf1d3', color: C.peach },
  '.gitmodules': { icon: '\uf1d3', color: C.peach },
  makefile: { icon: '\ue795', color: C.green },
  'package.json': { icon: '\ued0e', color: C.red },
  'package-lock.json': { icon: '\ued0e', color: C.red },
}
const PLAIN: Style = { icon: '\uf15b', color: C.text }

// devicons の色を暗い帯でも読めるようにする。暗すぎる色は白寄りに明るくする。
const legible = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const light = (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255
  if (light >= 0.35) return hex
  const t = 0.45
  return `#${[r!, g!, b!].map(v => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`
}
const fromDevicons = (entry: readonly [string, string] | undefined): Style | null =>
  entry ? { icon: entry[0], color: legible(entry[1]) } : null

// 表そのものが持つエントリだけを返す。Object のプロトタイプ由来のもの
// (`constructor` など)は返さない。
const own = <T,>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined)

// まず nvim-web-devicons をファイル名全体で、次にドット区切りの長い語尾から
// (`ts` より先に `d.ts`)引く。そこに無いか、このフォントに無いグリフなら上の
// 表を使う。それも無ければ普通のファイル。
export const styleOf = (name: string): Style => {
  const lower = name.toLowerCase()
  const whole = fromDevicons(own(DEVICONS_BY_NAME, name) ?? own(DEVICONS_BY_NAME, lower)) ?? own(BY_NAME, lower)
  if (whole) return whole
  if (lower === '.env' || lower.startsWith('.env.')) return { icon: '\uf462', color: C.yellow }
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {
    if (i === 1 && parts[0] === '') continue
    const ending = parts.slice(i).join('.')
    const style = fromDevicons(own(DEVICONS_BY_EXT, ending) ?? own(DEVICONS_BY_EXT, ending.toLowerCase())) ?? own(BY_EXT, ending.toLowerCase())
    if (style) return style
  }
  return PLAIN
}

const I = {
  folder: '',
  open: '',
  file: '',
  up: '',
  search: '',
  check: '',
  close: '',
  eye: '\uf06e',
  prev: '\uf053',
  next: '\uf054',
}

// 1ページに入る項目の行数。枠、見出し行、下のステータス帯の分を除いて帯に残る
// 高さだけ、この範囲内で取る。あわせて項目名の最大幅。
const MIN_ROWS = 6
const MAX_ROWS = 16
const CHROME_ROWS = 14
const MAX_CELL = 36

// キャレットがある `@` メンションを丸ごと読む。`@` から次の空白まで、キャレッ
// トがどこにあっても同じに読むので、表示するフォルダは本体の候補と同じく、書
// かれている文字列のとおりになる。
export const mentionAt = (text: string, cursor: number) => {
  const before = text.slice(0, cursor)
  // 引用符付き。本体は空白を含むパスをこの形で書く(`@"My Docs/a.txt"`)。`@"`
  // から閉じ引用符まで、キャレットはその中か直後にある。
  const q = /(?:^|\s)(@"[^"]*"?)$/.exec(before)
  if (q) {
    const start = cursor - (q[1] ?? '').length
    const closedAt = before.endsWith('"') && before.length - start > 2 ? cursor - 1 : text.indexOf('"', cursor)
    const close = closedAt < 0 ? text.length : closedAt
    return { start, end: Math.min(text.length, close + 1), query: text.slice(start + 2, close) }
  }
  const m = /(?:^|\s)@(\S*)$/.exec(before)
  if (!m) return null
  const start = cursor - (m[1] ?? '').length - 1
  const tail = /^\S*/.exec(text.slice(cursor))?.[0] ?? ''
  const end = cursor + tail.length
  return { start, end, query: text.slice(start + 1, end) }
}

// パスをメンションの形にする。空白を含むときは、本体が読める引用符付きにする。
export const mentionOf = (path: string) => (/\s/.test(path) ? `@"${path}"` : `@${path}`)

// 1文字が使う幅。幅広の文字(CJK、かな、ハングル、全角形)と絵文字は2、結合文字
// は0、それ以外は1。
const charWidth = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0
  if ((c >= 0x300 && c <= 0x36f) || (c >= 0x3099 && c <= 0x309a) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  if (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1f64f) ||
    (c >= 0x1f680 && c <= 0x1f6ff) ||
    (c >= 0x1f900 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
    return 2
  return 1
}
export const textWidth = (text: string) => [...text].reduce((n, ch) => n + charWidth(ch), 0)

// ラベルをちょうど `cells` マスに収める。足りなければ空白で埋め、長ければ `…`
// で切る。
export const fitCells = (label: string, cells: number) => {
  if (textWidth(label) <= cells) return label + ' '.repeat(cells - textWidth(label))
  let out = ''
  for (const ch of label) {
    if (textWidth(out) + charWidth(ch) > cells - 1) break
    out += ch
  }
  return out + '…' + ' '.repeat(Math.max(0, cells - 1 - textWidth(out)))
}

// メンションのフォルダ部分(最後の `/` まで)と、そこで打っている途中の名前。
export const splitQuery = (query: string) => {
  const slash = query.lastIndexOf('/')
  return { dir: query.slice(0, slash + 1), filter: query.slice(slash + 1) }
}

// メンションが指すフォルダを `ls` に渡すパスにする。セッションのディレクトリ
// からの相対、または書かれたとおりホームかルートから。
export const resolveDir = (dir: string, cwd: string, home: string) =>
  dir.startsWith('/') ? dir : dir.startsWith('~/') ? `${home}${dir.slice(1)}` : dir === '' ? cwd : `${cwd}/${dir}`

// フォルダを先に、次にファイル。それぞれ人が並べるような名前順。
const byKind = (a: Entry, b: Entry) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.dir ? -1 : 1)

// 打った文字で選ぶ項目。その文字で始まるものを先に、含むものを後に並べる。
export const matching = (entries: Entry[], filter: string) => {
  const f = filter.toLowerCase()
  if (f === '') return entries
  const starts = entries.filter(x => x.name.toLowerCase().startsWith(f))
  const within = entries.filter(x => !x.name.toLowerCase().startsWith(f) && x.name.toLowerCase().includes(f))
  return [...starts, ...within]
}

let home = ''
// 開始時のセッションのディレクトリ。分からないときは改めて問い合わせる。
let sessionCwd = ''
// 最後に一覧を取ったフォルダ。同じフォルダで名前を打っている間は取り直さない。
let listed: string | null = null
// 直前の編集で残ったプロンプトの中身。プロンプトの読み取りに応答が無いときに
// 使う。
let lastBox = { text: '', cursor: 0 }
// プロンプトの読み直し。セッション開始が再び走っても1つだけにする。
let recheckTimer: { cancel: () => void } | null = null

async function list($: any, dir: string) {
  const sort = (await read($, browser)).sort
  listed = `${sort}:${dir}`
  try {
    const cwd = sessionCwd || (await $.session.cwd().catch(() => '.'))
    const flags = SORTS.find(x => x.sort === sort)?.flags ?? '-1Ap'
    const r = await $.process.run(['ls', flags, resolveDir(dir, cwd, home)], { timeoutMs: 3000 })
    if (r.exitCode !== 0) {
      await update($, browser, b => (b.dir === dir ? { ...b, entries: [], error: 'No such folder' } : b))
      return
    }
    const entries = (r.stdout as string)
      .split('\n')
      .filter(line => line !== '')
      .map(line => (line.endsWith('/') ? { name: line.slice(0, -1), dir: true } : { name: line, dir: false }))
    // 新しい順は `ls` の結果のまま(フォルダとファイルが混ざる)。名前順とサイ
    // ズ順ではフォルダを先にする。
    if (sort === 'name') entries.sort(byKind)
    if (sort === 'size') entries.sort((a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1))
    await update($, browser, b => (b.dir === dir ? { ...b, entries, error: null } : b))
  } catch (err) {
    await update($, browser, b => (b.dir === dir ? { ...b, entries: [], error: String(err) } : b))
  }
}

// プロンプトの中身に追従する。キャレットが `@` メンションの中にある間は開いて
// そのフォルダを表示し、外れたら閉じる。
async function follow($: any, text: string, cursor: number) {
  const m = mentionAt(text, cursor)
  if (!m) {
    if ((await read($, browser)).active) await update($, browser, b => ({ ...closed, sort: b.sort, preview: b.preview }))
    listed = null
    return
  }
  const { dir, filter } = splitQuery(m.query)
  // メンションがファイル名全体を指しているなら、ここか本体の候補で選び終わっ
  // たということ。もう一覧を見る必要は無い。
  const b = await read($, browser)
  if (b.active && b.dir === dir && filter !== '' && b.entries.some(x => !x.dir && x.name === filter)) {
    await dismiss($)
    return
  }
  // フォルダや絞り込みが変わったら1ページ目に戻る。
  await update($, browser, x => ({
    ...x,
    active: true,
    dir,
    filter,
    entries: dir === x.dir ? x.entries : [],
    page: dir === x.dir && filter === x.filter ? x.page : 0,
    ext: dir === x.dir ? x.ext : null,
  }))
  if (listed !== `${(await read($, browser)).sort}:${dir}`) await list($, dir)
}

// 本体の候補を選ぶと、フックに届く編集なしにプロンプトが書き換わる。そのため
// ブラウザが開いている間は、プロンプトを読み直して追従する。
async function recheck($: any) {
  if (!(await read($, browser)).active) return
  try {
    const box = await $.prompt.read()
    if (box.text === lastBox.text && box.cursor === lastBox.cursor) return
    lastBox = { text: box.text, cursor: box.cursor }
    await follow($, box.text, box.cursor)
  } catch {
    // プロンプトが読めない(上にダイアログが出ている)。ブラウザはそのままにす
    // る。
  }
}

// キャレットがあるメンションを `@path` で書き換える。ファイル、またはフォルダ
// をそのまま選んだ場合はメンションを空白で閉じてブラウザを閉じる。フォルダを
// 開いた場合は `@path/` のまま続け、ブラウザもそこへ移る。
async function choose($: any, path: string, done: boolean) {
  await closePeek($)
  const box = await $.prompt.read().catch(() => lastBox)
  const m = mentionAt(box.text, box.cursor)
  if (!m) {
    await update($, browser, b => ({ ...closed, sort: b.sort, preview: b.preview }))
    return
  }
  const text = `${box.text.slice(0, m.start)}${mentionOf(path)}${done ? ' ' : ''}${box.text.slice(m.end)}`
  await $.prompt.fill({ text, mode: 'replace' })
  if (done) {
    await update($, browser, b => ({ ...closed, sort: b.sort, preview: b.preview }))
    listed = null
    return
  }
  await update($, browser, b => ({ ...b, dir: path, filter: '', entries: [], page: 0, ext: null }))
  await list($, path)
}

async function sortBy($: any, sort: Sort) {
  await closePeek($)
  const b = await read($, browser)
  if (b.sort === sort) return
  await update($, browser, x => ({ ...x, sort, page: 0 }))
  await list($, b.dir)
}

async function show($: any, kind: Kind, ext: string | null) {
  await closePeek($)
  await update($, browser, x => ({ ...x, kind, ext, page: 0 }))
}

async function turn($: any, by: number) {
  await closePeek($)
  await update($, browser, b => ({ ...b, page: Math.max(0, b.page + by) }))
}

// オンの間は、ファイルを押すとプロンプトに書き込まず、ブラウザを開いたまま
// Quick Look で表示する。
async function togglePreview($: any) {
  await closePeek($)
  await update($, browser, b => ({ ...b, preview: !b.preview }))
}

// Quick Look を開くスクリプト。セッションのバックグラウンドのホストから開いた
// パネルはターミナルの後ろに出るので、窓が立ち上がる間に何度か最前面へ出し、
// 前回のパネルが残っていれば閉じる。Quick Look が表示できない種類のテキスト
// は .txt の一時コピーで開く。別の .sh ファイルにせずここに文字列で埋め
// 込んでいるのは、プラグインのコードが自分のインストール先フォルダを知る API
// が無く、同梱したファイルを実行時に見つけられないため。インストール先
// (~/.claude/plugins/cache/<マーケットプレイス>/filepicker/<バージョン>/)はマ
// ーケットプレイス名やバージョンで変わるので決め打ちもできない。文字列で持て
// ば、マーケットプレイスからインストールしてもそのまま動く。
const PEEK_SCRIPT = `#!/bin/sh
pkill -x qlmanage 2>/dev/null
f="$1"
# Quick Look のパネルはファイル自身の種類で表示を決め、-c の指定はサムネイル
# にしか効かない。表示できる種類(プレーンテキスト、JSON、XML、ソースコード、
# HTML、SVG、RTF など)を含まないテキスト(.gitignore、TOML、拡張子の無い
# ファイル)は、.txt を付けた一時コピーを開く。コピーは利用者専用の $TMPDIR
# に置き、次のプレビューで消す。
tree=$(mdls -raw -name kMDItemContentTypeTree "$f" 2>/dev/null)
case "$tree" in
  *public.plain-text*|*public.json*|*public.xml*|*public.source-code*|*public.script*|*public.html*|*public.svg-image*|*public.rtf*) ;;
  *)
    if [ "$(file -b --mime-encoding "$f" 2>/dev/null)" != binary ]; then
      tmp="\${TMPDIR:-/tmp}"
      rm -rf "$tmp"/claude-filepicker-peek.* 2>/dev/null
      d=$(mktemp -d "$tmp/claude-filepicker-peek.XXXXXX") && cp "$f" "$d/$(basename "$f").txt" && f="$d/$(basename "$f").txt"
    fi
    ;;
esac
qlmanage -p "$f" >/dev/null 2>&1 &
for i in 1 2 3 4; do
  sleep 0.5
  osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "qlmanage") to true' >/dev/null 2>&1
done
exit 0
`

// ファイルを Quick Look で表示する。ブラウザは開いたまま。
// 今プレビューしているファイルのパス(メンションの書き方)。無ければ null。
let peeking: string | null = null

// プレビューを閉じる。開いていなければ何もしない。
async function closePeek($: any) {
  if (peeking === null) return
  peeking = null
  $.process.run(['pkill', '-x', 'qlmanage'], { timeoutMs: 3000 }).catch(() => undefined)
}

// 同じファイルをもう一度プレビューしようとしたら閉じる(トグル)。ただし利用者
// が窓を自分で閉じていた場合は開き直す。別のファイルならそちらに切り替える。
async function peek($: any, path: string) {
  if (peeking === path) {
    const open = await $.process
      .run(['pgrep', '-x', 'qlmanage'], { timeoutMs: 3000 })
      .then((r: any) => r.exitCode === 0)
      .catch(() => false)
    if (open) {
      await closePeek($)
      return
    }
  }
  peeking = path
  const cwd = sessionCwd || (await $.session.cwd().catch(() => '.'))
  const file = resolveDir(path, cwd, home)
  // スクリプトはファイルに書かず sh の標準入力に渡す(他のプロセスにすり替えら
  // れる余地を作らないため)。独立したセッションで起動して呼び出しの終了でパネ
  // ルが閉じないようにし、最前面化の完了も待たない。
  $.process
    .run(['perl', '-MPOSIX', '-e', 'setsid(); exec @ARGV or die', 'sh', '-s', '--', file], { stdin: PEEK_SCRIPT, timeoutMs: 8000 })
    .catch((err: unknown) => $.ui.toast(`Could not preview ${path}: ${String(err)}`))
}

async function dismiss($: any) {
  await closePeek($)
  await update($, browser, b => ({ ...closed, sort: b.sort, preview: b.preview }))
  listed = null
}

// ファイルの拡張子(ドットなし)。フォルダや、ドットで始まるだけのファイルには
// 無い。
export const extOf = (x: Entry) => (x.dir ? null : (/[^.]\.([^.]+)$/.exec(x.name)?.[1]?.toLowerCase() ?? null))

// 種類と拡張子で残す項目。順序は保つ。
export const ofKind = (entries: Entry[], kind: Kind, ext: string | null) =>
  entries.filter(x => (kind === 'dirs' ? x.dir : kind === 'files' ? !x.dir : true) && (ext === null || extOf(x) === ext))

// フォルダ内の拡張子。多いものから。
export const extensions = (entries: Entry[]) => {
  const counts = new Map<string, number>()
  for (const x of entries) {
    const ext = extOf(x)
    if (ext) counts.set(ext, (counts.get(ext) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([ext]) => ext)
}

// `.` と `..` をたどって解決し、ホームを `~` で表したパス。セッションのディレ
// クトリからの `../..` が実際にどこかを示す。
export const whereIs = (path: string, home: string) => {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const abs = `/${out.join('/')}`
  return home && (abs === home || abs.startsWith(`${home}/`)) ? `~${abs.slice(home.length)}` : abs
}

// メンションのフォルダの階層と、それぞれを開くパス。セッションのディレクトリ
// (`./`)、ホーム(`~/`)、ルート(`/`)のいずれかから始まり、`dir` まで1階層ずつ
// 並ぶ。
export const crumbs = (dir: string) => {
  const parts = dir.split('/').filter(p => p !== '')
  const root = dir.startsWith('/') ? { label: '/', path: '/' } : dir.startsWith('~/') ? { label: '~/', path: '~/' } : { label: './', path: '' }
  const rest = dir.startsWith('~/') ? parts.slice(1) : parts
  const steps = [root]
  let path = root.path
  for (const part of rest) {
    path = `${path}${part}/`
    steps.push({ label: `${part}/`, path })
  }
  return steps
}

// `dir` の1つ上のフォルダを、メンションの書き方で返す(`src/lib/` の上は
// `src/`)。
export const parentOf = (dir: string) => {
  // ルートの上は無い。ホームの上はホームの親。
  if (dir === '/') return '/'
  const trimmed = dir.replace(/\/$/, '')
  if (trimmed === '~') return '~/../'
  if (trimmed === '' || trimmed === '.') return '../'
  if (/(^|\/)\.\.$/.test(trimmed)) return `${trimmed}/../`
  const slash = trimmed.lastIndexOf('/')
  return slash < 0 ? '' : trimmed.slice(0, slash + 1)
}

async function drawBrowser($: any, e: any) {
  const b = await read($, browser)
  const { Box, Text, Button, Client } = $.ui.resolve(e)
  // 枠の線と内側の余白で4マス、外側の余白でさらに1マス使う。
  const width = Math.max(20, e.props.bodyColumns - 6)
  const narrow = width < NARROW
  const label = (icon: string, words: string) => (narrow ? icon : `${icon} ${words}`)

  const shown = matching(ofKind(b.entries, b.kind, b.ext), b.filter)
  // macOS はファイル名を分解した形(か + ゛)で返す。表示は合成した形にし、幅は
  // マス数で測る。
  const longest = shown.reduce((n, x) => Math.max(n, textWidth(x.name.normalize('NFC'))), 2)
  const cell = Math.min(MAX_CELL, longest + 5)
  const cols = Math.max(1, Math.floor(width / cell))
  const items: { key: string; label: string; color: string; path: string; done: boolean }[] = []
  if (b.filter === '') items.push({ key: 'fp-up', label: `${I.up} ..`, color: C.dim, path: parentOf(b.dir), done: false })
  for (const x of shown) {
    items.push({
      key: `fp-${x.dir ? 'd' : 'f'}-${x.name}`,
      label: `${x.dir ? I.folder : styleOf(x.name).icon} ${x.name.normalize('NFC')}${x.dir ? '/' : ''}`,
      color: x.dir ? C.blue : styleOf(x.name).color,
      path: `${b.dir}${x.name}${x.dir ? '/' : ''}`,
      done: !x.dir,
    })
  }
  // 行に入るだけの項目を1ページとし、◀ ▶ でめくる。
  const pageRows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, (e.props.maxRows ?? 20) - CHROME_ROWS))
  const size = cols * pageRows
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.min(b.page, pages - 1)
  const visible = items.slice(page * size, (page + 1) * size)

  const fit = (label: string) => fitCells(label, cell - 1)
  // 複数から1つを選ぶボタン。グループの色で、選択中はその色で塗り、それ以外は
  // その色の文字で書く。
  const chip = (key: string, label: string, on: boolean, tint: string, press: () => Promise<void>) => (
    <Button key={key} plain onPress={press}>
      <Text color={on ? C.ink : tint} backgroundColor={on ? tint : C.block} bold={on}>
        {` ${label} `}
      </Text>
    </Button>
  )
  // パンくずは先頭の階層と、見出しの残りに入るだけの末尾の階層を残し、間を `…
  // /` にする。見出しの他の部分の幅はここで見積もる。
  const all = crumbs(b.dir)
  const fixed = 4 + (narrow ? 10 : 15) + (b.filter ? b.filter.length + 3 : 0) + (/(^|\/)\.\.(\/|$)/.test(b.dir) ? 12 : 0)
  const room = Math.max(8, width - fixed)
  const len = (xs: { label: string }[]) => xs.reduce((n, x) => n + [...x.label].length, 0)
  let steps: { step: { label: string; path: string } | null; i: number }[] = all.map((step, i) => ({ step, i }))
  if (len(all) > room && all.length > 2) {
    let k = all.length - 2
    while (k > 1 && len(all.slice(0, 1)) + 2 + len(all.slice(all.length - k)) > room) k--
    steps = [
      { step: all[0]!, i: 0 },
      { step: null, i: -1 },
      ...all.slice(all.length - k).map((step, j) => ({ step, i: all.length - k + j })),
    ]
  }
  const rows: (typeof visible)[] = []
  for (let i = 0; i < visible.length; i += cols) rows.push(visible.slice(i, i + cols))

  return (
    <Box key="filepicker" flexDirection="column" marginLeft={1} marginY={1} borderStyle="round" borderColor={C.blue} paddingX={1}>
      <Box key="fp-head" columnGap={1}>
        <Box key="fp-dir">
          <Text key="fp-dir-icon" color={C.ink} backgroundColor={C.blue} bold>
            {` ${I.open} `}
          </Text>
          {steps.map(({ step: c, i }) =>
            c === null ? (
              <Text key={`fp-crumb-gap-${i}`} color={C.ink} backgroundColor={C.blue}>
                …/
              </Text>
            ) : (
              <Button key={`fp-crumb-${i}`} plain onPress={() => choose($, c.path, false)}>
                <Text color={C.ink} backgroundColor={C.blue} bold>
                  {c.label}
                </Text>
              </Button>
            ),
          )}
          <Text key="fp-dir-end" color={C.ink} backgroundColor={C.blue}>
            {' '}
          </Text>
        </Box>
        {/(^|\/)\.\.(\/|$)/.test(b.dir) && sessionCwd ? (
          <Text key="fp-where" color={C.dim} wrap="truncate-start">
            {`→ ${whereIs(resolveDir(b.dir, sessionCwd, home), home)}`}
          </Text>
        ) : null}
        {b.filter ? (
          <Text key="fp-filter" color={C.yellow}>
            {`${I.search} ${b.filter}`}
          </Text>
        ) : null}
        <Box key="fp-gap" flexGrow={1}>
          <Text key="fp-gap-t"> </Text>
        </Box>
        <Button key="fp-preview" plain onPress={() => togglePreview($)}>
          <Text color={b.preview ? C.ink : C.yellow} backgroundColor={b.preview ? C.yellow : C.block} bold>
            {` ${label(I.eye, 'Preview')} `}
          </Text>
        </Button>
        <Button key="fp-this" plain onPress={() => choose($, b.dir === '' ? './' : b.dir, true)}>
          <Text color={C.ink} backgroundColor={C.green} bold>
            {` ${I.check} `}
          </Text>
        </Button>
        <Button key="fp-close" plain onPress={() => dismiss($)}>
          <Text color={C.text} backgroundColor={C.block} bold>
            {` ${I.close} `}
          </Text>
        </Button>
      </Box>
      {b.error ? (
        <Box key="fp-error">
          <Text color={C.dim}>{`  ${b.error}`}</Text>
        </Box>
      ) : null}
      {rows.length > 0 ? (
        <Client
          key="fp-grid"
          module="./grid.tsx"
          props={{ cell, rows: rows.map(row => row.map(item => ({ label: fit(item.label), color: item.color, path: item.path, done: item.done }))) }}
        />
      ) : null}
      {pages > 1 ? (
        <Box key="fp-pages" columnGap={1}>
          <Button key="fp-prev" plain onPress={() => turn($, -1)}>
            <Text color={page > 0 ? C.text : C.dim} backgroundColor={C.block} bold>
              {` ${I.prev} `}
            </Text>
          </Button>
          <Text key="fp-page" color={C.dim}>{narrow ? `${page + 1}/${pages}` : `${page + 1} / ${pages}  ·  ${items.length} entries`}</Text>
          <Button key="fp-next" plain onPress={() => turn($, page < pages - 1 ? 1 : 0)}>
            <Text color={page < pages - 1 ? C.text : C.dim} backgroundColor={C.block} bold>
              {` ${I.next} `}
            </Text>
          </Button>
        </Box>
      ) : null}
      <Box key="fp-sorts" columnGap={1} flexWrap="wrap" marginTop={1}>
        <Text key="fp-sort-l" color={C.peach} bold>
          {label('\uf0dc', 'Sort')}
        </Text>
        {SORTS.map(x => chip(`fp-sort-${x.sort}`, label(x.icon, x.label), b.sort === x.sort, C.peach, () => sortBy($, x.sort)))}
      </Box>
      <Box key="fp-filters" columnGap={1} flexWrap="wrap">
        <Text key="fp-kind-l" color={C.mauve} bold>
          {label('\uf0b0', 'Filter')}
        </Text>
        {KINDS.map(x => chip(`fp-kind-${x.kind}`, label(x.icon, x.label), b.kind === x.kind && b.ext === null, C.mauve, () => show($, x.kind, null)))}
        {extensions(b.entries)
          .slice(0, MAX_EXTS)
          .map(ext => {
            // 拡張子ごとに、その種類のアイコンと色を使う。
            const st = styleOf(`x.${ext}`)
            return chip(`fp-ext-${ext}`, `${st.icon} .${ext}`, b.ext === ext, st.color === C.text ? C.teal : st.color, () => show($, 'files', b.ext === ext ? null : ext))
          })}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await $.process.run(['sh', '-c', 'printf %s "$HOME"'])).stdout
    sessionCwd = e.cwd
    recheckTimer?.cancel()
    recheckTimer = $.clock.every(400, () => void recheck($))
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    // 文字を打ったら、プレビューは閉じる。
    if (r.text !== e.text) await closePeek($)
    lastBox = { text: r.text, cursor: r.cursor }
    await follow($, r.text, r.cursor)
    return r
  })

  // プロンプトを送信したらメンションは終わり。
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, browser)).active) await dismiss($)
    return next(e)
  })

  // 一覧のクリックとキー入力。pick は項目を書き込み(フォルダなら開き)、peek
  // はファイルを Quick Look で表示する。Preview がオンのときは、ファイルの普
  // 通のクリックも peek になる。
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'fp-grid') return next(e)
    const d = e.data as { kind?: string; path?: string; done?: boolean }
    // 一覧の空き部分のクリックは、プレビューを閉じるだけ。
    if (d?.kind === 'blank') {
      await closePeek($)
      return next(e)
    }
    if (typeof d?.path !== 'string') return next(e)
    const preview = (await read($, browser)).preview
    if (d.kind === 'peek' || (preview && d.done)) await peek($, d.path)
    else await choose($, d.path, d.done === true)
    return next(e)
  })

  // 帯に描かれる他のものの上に、ブラウザを置く。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, browser)).active) return next(e)
    const { Box } = $.ui.resolve(e)
    const rest = await next(e)
    return (
      <Box flexDirection="column">
        {await drawBrowser($, e)}
        {rest}
      </Box>
    )
  })
}
