import type { ClientModule } from 'claude-code'

// One entry of the grid, its label already laid to the cell's width.
type Item = { label: string; color: string; path: string; done: boolean }
type Props = { cell: number; rows: Item[][] }
type State = { hover: number | null; onIcon: boolean; cursor: number | null }

// The entries as a grid that reads the pointer itself, so where a click lands
// in its cell says what it does: on a file's icon it shows the file in Quick
// Look, on its name it picks it (a folder opens either way). An option-click
// (alt on Windows) previews too, where the terminal reports the key.
// Clicked, it takes the keys: arrows move, Return picks, Space previews.
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
  // The icon and the blank after it: the first two columns of a cell.
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
      send(i, e.alt === true || onIconAt(e.x))
    }
  })

  surface.onKey(k => {
    const from = state.cursor ?? 0
    const move = (to: number) => surface.setState({ ...state, cursor: Math.max(0, Math.min(items.length - 1, to)) })
    if (k.key === 'right') move(from + 1)
    else if (k.key === 'left') move(from - 1)
    else if (k.key === 'down') move(from + cols)
    else if (k.key === 'up') move(from - cols)
    else if (k.key === 'return') send(from, false)
    else if (k.key === ' ') send(from, true)
  })

  return (
    <Box flexDirection="column">
      {props.rows.map((row, r) => (
        <Box key={`g${r}`}>
          {row.map((item, c) => {
            const i = r * cols + c
            // Under the pointer, a file's icon lights alone (a press there
            // previews), or the whole entry does (a press picks).
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
