export type Worktree = { path: string; branch: string | null; current: boolean }
export type Agent = { id: string; description: string; type: string; status: string }
export type Snap = {
  model: string
  effort: string | null
  modelOptions: string[]
  worktrees: Worktree[]
  agents: Agent[]
}
export type View = { drawer: 'worktrees' | 'agents' | null }
export type Picker = 'model' | 'effort' | null

declare module 'claude-code' {
  interface PluginState {
    'statusbar-buttons': { snap: Snap; view: View; picker: Picker }
  }
}
