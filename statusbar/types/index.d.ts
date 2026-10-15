export type Limit = { kind: string; percent: number; resetsAt: string | null }
export type Worktree = { path: string; branch: string | null; current: boolean }
export type Agent = { id: string; description: string; type: string; status: string }
export type Snap = {
  model: string
  effort: string | null
  modelOptions: string[]
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  acPercent: number | null
  limits: Limit[]
  cwd: string
  branch: string | null
  dirty: boolean
  changes: number
  ahead: number
  behind: number
  pr: { number: number; title: string; state: string; url: string } | null
  worktrees: Worktree[]
  agents: Agent[]
}
export type View = { drawer: 'worktrees' | 'agents' | null; compact: boolean }
export type Picker = 'model' | 'effort' | null

declare module 'claude-code' {
  interface PluginState {
    statusbar: { snap: Snap; view: View; picker: Picker }
  }
}
