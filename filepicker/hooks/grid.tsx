import type { ClientModule } from 'claude-code'

// 一覧の1項目。ラベルはセルの幅に合わせ済み。
type Item = { label: string; color: string; path: string; done: boolean }
type Props = { cell: number; rows: Item[][] }
type State = { hover: number | null; onIcon: boolean; cursor: number | null }

// 項目を並べた一覧で、ポインタを自分で読む。そのためセルのどこを押したかで動
// 作を分けられる。ファイルのアイコンを押すと Quick Look で表示し、名前を押す
// と選択する(フォルダはどちらでも開く)。option+クリック(Windows では alt+クリ
// ック)も、ターミナルがそのキーを報告する場合はプレビューになる。クリックする
// とキー入力を受け取り、矢印で移動、Return で選択、Space でプレビューする。
const Grid: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? { hover: null, onIcon: false, cursor: null }
  const items = props.rows.flat()
  const cols = Math.max(1, props.rows[0]?.length ?? 1)

  const at = (x: number, y: number) => {
    const col = Math.floor(x / props.cell)
    if (x < 0 || y < 0 || col >= cols) return null
    const i = y * cols + col
    return i < items.length ? i : null
  }
  // アイコンとその後の空白。セルの先頭2マス。
  const onIconAt = (x: number) => x - Math.floor(x / props.cell) * props.cell < 2
  const send = (i: number | null, peek: boolean) => {
    const item = i === null ? undefined : items[i]
    if (!item) return
    surface.post({ kind: peek && item.done ? 'peek' : 'pick', path: item.path, done: item.done })
  }

  surface.onPointer(e => {
    if (e.type === 'move' || e.type === 'enter') {
      const hover = at(e.x, e.y)
      const onIcon = onIconAt(e.x)
      if (hover !== state.hover || onIcon !== state.onIcon) surface.setState({ ...state, hover, onIcon })
    } else if (e.type === 'leave') {
      if (state.hover !== null) surface.setState({ ...state, hover: null })
    } else if (e.type === 'down') {
      const i = at(e.x, e.y)
      surface.setState({ ...state, cursor: i })
      // 項目の無い所を押したら、それを伝えてプレビューを閉じさせる。
      if (i === null) surface.post({ kind: 'blank' })
      else send(i, e.alt === true || onIconAt(e.x))
    }
  })

  surface.onKey(k => {
    const from = state.cursor ?? 0
    const move = (to: number) => surface.setState({ ...state, cursor: Math.max(0, Math.min(items.length - 1, to)) })
    if (k.key === 'right') move(from + 1)
    else if (k.key === 'left') move(from - 1)
    else if (k.key === 'down') move(from + cols)
    else if (k.key === 'up') move(from - cols)
    // Return と Space は選択中の項目にだけ働く。空き部分をクリックした後に、
    // 既定で先頭の項目に働くことはない。
    else if (k.key === 'return' && state.cursor !== null) send(state.cursor, false)
    else if (k.key === ' ' && state.cursor !== null) send(state.cursor, true)
  })

  return (
    <Box flexDirection="column">
      {props.rows.map((row, r) => (
        <Box key={`g${r}`}>
          {row.map((item, c) => {
            const i = r * cols + c
            // ポインタの下では、ファイルのアイコンだけが光る(押すとプレビュー
            // )か、項目全体が光る(押すと選択)。
            const hovered = i === state.hover
            const iconLit = hovered && state.onIcon && item.done
            const lit = (hovered && !iconLit) || i === state.cursor
            const [icon = '', ...rest] = [...item.label]
            return (
              <Box key={`g${r}-${c}`}>
                <Text color={iconLit ? '#1e1e2e' : item.color} backgroundColor={iconLit ? '#f9e2af' : undefined} inverse={lit}>
                  {icon}
                </Text>
                <Text color={item.color} inverse={lit}>
                  {rest.join('')}
                </Text>
                <Text> </Text>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export default Grid
