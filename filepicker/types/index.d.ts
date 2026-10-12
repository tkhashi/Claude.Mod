export type Entry = { name: string; dir: boolean }
export type Sort = 'mtime' | 'name' | 'size'
export type Kind = 'all' | 'dirs' | 'files'
export type Browser = {
  active: boolean
  dir: string
  filter: string
  entries: Entry[]
  error: string | null
  page: number
  sort: Sort
  kind: Kind
  ext: string | null
  preview: boolean
}

declare module 'claude-code' {
  interface PluginState {
    filepicker: { browser: Browser }
  }
}
