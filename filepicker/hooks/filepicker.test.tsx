import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { crumbs, extensions, fitCells, mentionOf, styleOf, textWidth, whereIs, matching, mentionAt, ofKind, parentOf, resolveDir, splitQuery } from './register'
import { DEVICONS_BY_EXT, DEVICONS_BY_NAME } from './devicons'

// The engine beneath the plugin: a draft the person edits, a folder tree `ls`
// reads, and the band's own drawing.
const engine = (on: On, box: { text: string; cursor: number }, filled: string[], ran: string[] = []) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-band">band</Text>
  })
  on('prompt.edit', async (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    box.text = text
    box.cursor = e.start + e.inputText.length
    return { text, cursor: box.cursor } as any
  })
  on('prompt.read', async (_$, _e) => ({ value: { ...box } }) as any)
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)
    box.text = e.text
    box.cursor = e.text.length
    return { isFilled: true, text: box.text, cursor: box.cursor } as any
  })
  on('prompt.submit', async (_$, _e) => ({}) as any)
  on('session.cwd', async (_$, _e) => ({ value: '/repo' }) as any)
  on('process.run', async (_$, e: any) => {
    const argv = JSON.stringify(e)
    ran.push(argv)
    if (argv.includes('setsid')) return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as any
    if (argv.includes('/repo/many')) return out(Array.from({ length: 80 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`).join('\n'))
    // Newest first with -t: util.ts was touched last, app.ts first.
    if (argv.includes('/repo/My Docs')) return out('a b.txt\n')
    if (argv.includes('/repo/src')) return out(argv.includes('-1Apt') ? 'util.ts\nlib/\nREADME.md\napp.ts\n' : 'README.md\napp.ts\nlib/\nutil.ts\n')
    if (argv.includes('/repo')) return out('README.md\nsrc/\n.git/\nMy Docs/\n')
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as any
  })
}

const type = ($: any, box: { text: string; cursor: number }, input: string) =>
  $.prompt.edit({ origin: { kind: 'composer' }, text: box.text, cursor: box.cursor, start: box.cursor, end: box.cursor, inputText: input })

// The grid's cells as drawn by its module: each entry's name (a folder's
// with its `/`), and where on the grid a pointer finds it.
const cells = async (ui: any) => {
  const out: { name: string; x: number; y: number }[] = []
  let tree: any
  try {
    tree = await ui.drawn({ in: 'fp-grid' })
  } catch {
    return out
  }
  const text = (el: any): string => (typeof el === 'string' ? el : (el?.children ?? []).map(text).join(''))
  ;(tree?.children ?? []).forEach((row: any, y: number) => {
    let x = 0
    for (const cell of row?.children ?? []) {
      const label = text(cell)
      const name = label.trim().split(' ').slice(1).join(' ')
      out.push({ name, x, y })
      x += [...label].length
    }
  })
  return out
}

// The entries' names in the order drawn, `..` left out.
const order = async (ui: any) => (await cells(ui)).map(c => c.name.replace(/\/$/, '')).filter(n => n !== '..')
const shows = async (ui: any, name: string) => (await cells(ui)).some(c => c.name === name)

// A click on the entry's name, plain or with option (alt) held.
const click = async (ui: any, name: string, alt = false) => {
  const cell = (await cells(ui)).find(c => c.name === name)
  if (!cell) throw new Error(`no entry ${name}`)
  await ui.pointer({ type: 'down', x: cell.x + 2, y: cell.y, button: 'left', ...(alt ? { alt: true } : {}), in: 'fp-grid' })
}

const band = ($: any, bodyColumns = 100) =>
  $.ui.mount({
    plugin: 'filepicker',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns, scroll: { bodyRows: 20 } },
  } as any)

test('typing @ opens the browser above the band; a space closes it', async ($, on) => {
  const box = { text: 'look at ', cursor: 8 }
  engine(on, box, [])
  const ui = await band($)
  expect(await ui.find({ type: 'Box', key: 'filepicker' }), 'closed before the @').toBeUndefined()
  await type($, box, '@src/')
  expect((await ui.find({ type: 'Box', key: 'fp-head' }))?.text, 'on the folder typed').toEqual(expect.stringMatching(/\.\/src\//))
  expect(await ui.find({ type: 'Text', text: 'band' }), 'the band still drawn under it').toBeDefined()
  await type($, box, ' ')
  expect(await ui.find({ type: 'Box', key: 'filepicker' }), 'closed after a space').toBeUndefined()
  await ui.unmount()
})

test('taking the folder writes it over the mention and closes', async ($, on) => {
  const box = { text: 'see ', cursor: 4 }
  const filled: string[] = []
  engine(on, box, filled)
  const ui = await band($)
  await type($, box, '@src/')
  await ui.press({ key: 'fp-this' })
  expect(filled).toEqual(['see @src/ '])
  expect(await ui.find({ type: 'Box', key: 'filepicker' })).toBeUndefined()
  await ui.unmount()
})

test('typing @ lists the folder, folders first', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($)
  await type($, box, '@')
  expect(await shows(ui, 'src/'), 'the folder').toBe(true)
  expect(await shows(ui, 'README.md'), 'the file').toBe(true)
  await ui.unmount()
})

test('a folder opens as @path/, a file ends the mention and closes', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  engine(on, box, filled)
  const ui = await band($)
  await type($, box, '@')
  await click(ui, 'src/')
  expect(filled.at(-1)).toBe('@src/')
  expect(await shows(ui, 'app.ts'), 'the folder listed').toBe(true)
  await click(ui, 'app.ts')
  expect(filled.at(-1)).toBe('@src/app.ts ')
  expect(await ui.find({ type: 'Box', key: 'filepicker' }), 'closed').toBeUndefined()
  await ui.unmount()
})

test('typing narrows the entries', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($)
  await type($, box, '@src/u')
  expect(await shows(ui, 'util.ts')).toBe(true)
  expect(await shows(ui, 'app.ts'), 'filtered out').toBe(false)
  await ui.unmount()
})

test('a file named whole closes the browser, as when an engine suggestion is taken', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($)
  await type($, box, '@src/')
  expect(await ui.find({ type: 'Box', key: 'filepicker' })).toBeDefined()
  await type($, box, 'app.ts')
  expect(await ui.find({ type: 'Box', key: 'filepicker' }), 'closed on the whole name').toBeUndefined()
  await ui.unmount()
})

test('a long folder pages with ◀ ▶, every entry reachable', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($)
  await type($, box, '@many/')
  expect(await shows(ui, 'f00.txt'), 'the first page').toBe(true)
  expect(await shows(ui, 'f79.txt'), 'the last not yet').toBe(false)
  for (let i = 0; i < 20 && !(await shows(ui, 'f79.txt')); i++) await ui.press({ key: 'fp-next' })
  expect(await shows(ui, 'f79.txt'), 'reached by paging').toBe(true)
  await ui.press({ key: 'fp-prev' })
  expect(await shows(ui, 'f79.txt'), 'back a page').toBe(false)
  await ui.unmount()
})

test('newest first by default; Name sorts folders first, then by name', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($)
  await type($, box, '@src/')
  expect(await order(ui)).toEqual(['util.ts', 'lib', 'README.md', 'app.ts'])
  await ui.press({ key: 'fp-sort-name' })
  expect(await order(ui)).toEqual(['lib', 'app.ts', 'README.md', 'util.ts'])
  await ui.unmount()
})

test('Show narrows to folders, files, or one extension', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($)
  await type($, box, '@src/')
  await ui.press({ key: 'fp-kind-dirs' })
  expect(await order(ui)).toEqual(['lib'])
  await ui.press({ key: 'fp-kind-files' })
  expect(await order(ui)).toEqual(['util.ts', 'README.md', 'app.ts'])
  await ui.press({ key: 'fp-ext-ts' })
  expect(await order(ui)).toEqual(['util.ts', 'app.ts'])
  await ui.press({ key: 'fp-ext-ts' })
  expect(await order(ui), 'pressed again, every file').toEqual(['util.ts', 'README.md', 'app.ts'])
  await ui.unmount()
})

test('the extensions offered are the commonest; kinds keep the order', () => {
  const entries = [
    { name: 'a.ts', dir: false },
    { name: 'b.md', dir: false },
    { name: 'c.ts', dir: false },
    { name: '.env', dir: false },
    { name: 'lib', dir: true },
  ]
  expect(extensions(entries)).toEqual(['ts', 'md'])
  expect(ofKind(entries, 'files', 'ts').map(x => x.name)).toEqual(['a.ts', 'c.ts'])
  expect(ofKind(entries, 'dirs', null).map(x => x.name)).toEqual(['lib'])
})

test('an option-click previews the file, the browser kept and nothing written', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  const ran: string[] = []
  engine(on, box, filled, ran)
  const ui = await band($)
  await type($, box, '@src/')
  await click(ui, 'app.ts', true)
  expect(ran.some(r => r.includes('setsid') && r.includes('src/app.ts')), 'quick look asked').toBe(true)
  expect(filled).toEqual([])
  expect(await shows(ui, 'app.ts'), 'still open').toBe(true)
  await ui.unmount()
})

test('a click on a file\'s icon previews it; on a folder\'s, opens it', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  const ran: string[] = []
  engine(on, box, filled, ran)
  const ui = await band($)
  await type($, box, '@src/')
  const file = (await cells(ui)).find(c => c.name === 'app.ts')!
  await ui.pointer({ type: 'down', x: file.x, y: file.y, button: 'left', in: 'fp-grid' })
  expect(ran.some(r => r.includes('setsid') && r.includes('src/app.ts')), 'previewed').toBe(true)
  expect(filled, 'nothing written').toEqual([])
  const folder = (await cells(ui)).find(c => c.name === 'lib/')!
  await ui.pointer({ type: 'down', x: folder.x, y: folder.y, button: 'left', in: 'fp-grid' })
  expect(filled.at(-1)).toBe('@src/lib/')
  await ui.unmount()
})

test('a ctrl-click is a plain pick, left to the right button', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  engine(on, box, filled)
  const ui = await band($)
  await type($, box, '@src/')
  const cell = (await cells(ui)).find(c => c.name === 'app.ts')!
  await ui.pointer({ type: 'down', x: cell.x + 2, y: cell.y, button: 'left', ctrl: true, in: 'fp-grid' })
  expect(filled.at(-1)).toBe('@src/app.ts ')
  await ui.unmount()
})

test('in the grid, arrows move, Space previews, Return picks', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  const ran: string[] = []
  engine(on, box, filled, ran)
  const ui = await band($)
  await type($, box, '@src/')
  // .. first, then util.ts, newest first.
  await ui.key({ key: 'right', in: 'fp-grid' })
  await ui.key({ key: ' ', in: 'fp-grid' })
  expect(ran.some(r => r.includes('setsid') && r.includes('src/util.ts')), 'previewed').toBe(true)
  await ui.key({ key: 'return', in: 'fp-grid' })
  expect(filled.at(-1)).toBe('@src/util.ts ')
  await ui.unmount()
})

test('a breadcrumb step opens its folder', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  engine(on, box, filled)
  const ui = await band($)
  await type($, box, '@src/lib/')
  await ui.press({ key: 'fp-crumb-1' })
  expect(filled.at(-1)).toBe('@src/')
  expect(await shows(ui, 'app.ts'), 'src listed').toBe(true)
  await ui.press({ key: 'fp-crumb-0' })
  expect(filled.at(-1)).toBe('@')
  expect(await shows(ui, 'src/'), 'the top listed').toBe(true)
  await ui.unmount()
})

test('breadcrumbs step from the start the mention names', () => {
  expect(crumbs('src/lib/')).toEqual([
    { label: './', path: '' },
    { label: 'src/', path: 'src/' },
    { label: 'lib/', path: 'src/lib/' },
  ])
  expect(crumbs('~/notes/').map(c => c.path)).toEqual(['~/', '~/notes/'])
  expect(crumbs('/etc/').map(c => c.path)).toEqual(['/', '/etc/'])
})

test('a file takes devicons\' icon, by name, then the longest ending, then the table', () => {
  expect(styleOf('app.ts').icon).toBe(DEVICONS_BY_EXT['ts']![0])
  expect(styleOf('types.d.ts').icon, 'd.ts before ts').toBe(DEVICONS_BY_EXT['d.ts']![0])
  expect(styleOf('logo.PNG').icon).toBe(DEVICONS_BY_EXT['png']![0])
  expect(styleOf('package.json').icon).toBe(DEVICONS_BY_NAME['package.json']![0])
  expect(styleOf('Dockerfile').icon).toBe((DEVICONS_BY_NAME['Dockerfile'] ?? DEVICONS_BY_NAME['dockerfile'])![0])
  expect(styleOf('Main.xaml').icon).toBe((DEVICONS_BY_EXT['xaml'] ?? ['\u{f0673}'])[0])
  expect(DEVICONS_BY_EXT['css'], 'css lacks its glyph in this font').toBeUndefined()
  expect(styleOf('site.css').icon, 'so the table draws it').toBe('\ue749')
  expect(styleOf('notes').icon, 'a plain file').toBe('\uf15b')
  expect(styleOf('.env.local').icon).toBe('\uf462')
})
test('a folder reached through .. is told by where it is', () => {
  expect(whereIs('/Users/me/Documents/github/Claude/../..', '/Users/me')).toBe('~/Documents')
  expect(whereIs('/Users/me/x/../../..', '/Users/me')).toBe('/')
  expect(whereIs('/opt/./tools/', '/Users/me')).toBe('/opt/tools')
})

test('narrow, the controls are icons and a deep path is cut in the middle', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($, 44)
  await type($, box, '@alpha/bravo/charlie/delta/echo/foxtrot/')
  const head = (await ui.find({ type: 'Box', key: 'fp-head' }))?.text ?? ''
  expect(head, 'cut with …/').toEqual(expect.stringMatching(/\.\/…\/.*foxtrot\//))
  expect(head, 'the folder button as an icon').not.toEqual(expect.stringMatching(/this folder/))
  expect((await ui.find({ type: 'Box', key: 'fp-sorts' }))?.text, 'sorts as icons').not.toEqual(expect.stringMatching(/Modified/))
  await ui.unmount()
  const wide = await band($, 140)
  expect((await wide.find({ type: 'Box', key: 'fp-head' }))?.text, 'whole when wide').toEqual(expect.stringMatching(/alpha\/bravo\/charlie\/delta\/echo\/foxtrot\//))
  await wide.unmount()
})

test('moving the caret back inside the mention keeps its folder', async ($, on) => {
  const box = { text: '', cursor: 0 }
  engine(on, box, [])
  const ui = await band($)
  await type($, box, '@src/')
  expect(await shows(ui, 'app.ts')).toBe(true)
  // The caret steps back to just after the @.
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: box.text, cursor: box.cursor, start: 1, end: 1, inputText: '' })
  box.cursor = 1
  expect(await shows(ui, 'app.ts'), 'still src').toBe(true)
  await ui.unmount()
})

test('Preview on, a file opens in Quick Look and the browser stays', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  const ran: string[] = []
  engine(on, box, filled, ran)
  const ui = await band($)
  await type($, box, '@src/')
  await ui.press({ key: 'fp-preview' })
  await click(ui, 'app.ts')
  expect(ran.some(r => r.includes('setsid') && r.includes('src/app.ts')), 'quick look asked').toBe(true)
  expect(filled, 'nothing written').toEqual([])
  expect(await ui.find({ type: 'Box', key: 'filepicker' }), 'still open').toBeDefined()
  await ui.unmount()
})

test('wide characters take two columns, so a grid cell stays its width', () => {
  expect(textWidth('資料.md')).toBe(7)
  expect(textWidth('か\u3099')).toBe(2)
  expect(textWidth(fitCells('とても長い日本語のファイル名.txt', 12))).toBe(12)
  expect(textWidth(fitCells('a.ts', 12))).toBe(12)
})

test('a name with a blank is written quoted, and the quoted mention read back', async ($, on) => {
  const box = { text: '', cursor: 0 }
  const filled: string[] = []
  engine(on, box, filled)
  const ui = await band($)
  await type($, box, '@')
  await click(ui, 'My Docs/')
  expect(filled.at(-1)).toBe('@"My Docs/"')
  expect(await shows(ui, 'a b.txt'), 'the quoted folder listed').toBe(true)
  await click(ui, 'a b.txt')
  expect(filled.at(-1)).toBe('@"My Docs/a b.txt" ')
  await ui.unmount()
})

test('quoted mentions, the root and the home', () => {
  expect(mentionAt('see @"My Docs/a', 15)).toEqual({ start: 4, end: 15, query: 'My Docs/a' })
  expect(mentionAt('see @"My Docs/" x', 15), 'the caret just past the quote').toEqual({ start: 4, end: 15, query: 'My Docs/' })
  expect(mentionAt('see @"My Docs/" x', 16), 'past the mention').toBeNull()
  expect(mentionOf('a b/')).toBe('@"a b/"')
  expect(mentionOf('src/')).toBe('@src/')
  expect(parentOf('/')).toBe('/')
  expect(parentOf('~/')).toBe('~/../')
})

test('the mention, its folder and its filter are read from the caret', () => {
  expect(mentionAt('look at @src/co', 15)).toEqual({ start: 8, end: 15, query: 'src/co' })
  expect(mentionAt('look at @src/co now', 11), 'the whole mention, the caret inside it').toEqual({ start: 8, end: 15, query: 'src/co' })
  expect(mentionAt('a@b', 3), 'not after a word').toBeNull()
  expect(mentionAt('@x y', 4), 'past the mention').toBeNull()
  expect(splitQuery('src/lib/ut')).toEqual({ dir: 'src/lib/', filter: 'ut' })
  expect(splitQuery('README')).toEqual({ dir: '', filter: 'README' })
  expect(resolveDir('src/', '/repo', '/home/me')).toBe('/repo/src/')
  expect(resolveDir('~/notes/', '/repo', '/home/me')).toBe('/home/me/notes/')
  expect(resolveDir('', '/repo', '/home/me')).toBe('/repo')
})

test('entries the filter begins come before those it appears in; .. climbs', () => {
  const entries = [
    { name: 'app.ts', dir: false },
    { name: 'util.ts', dir: false },
    { name: 'utils', dir: true },
  ]
  expect(matching(entries, 'ut').map(x => x.name)).toEqual(['util.ts', 'utils'])
  expect(matching(entries, 'ts').map(x => x.name)).toEqual(['app.ts', 'util.ts'])
  expect(parentOf('src/lib/')).toBe('src/')
  expect(parentOf('src/')).toBe('')
  expect(parentOf('')).toBe('../')
  expect(parentOf('../')).toBe('../../')
})
