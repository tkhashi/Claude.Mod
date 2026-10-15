export type Call = { id: string; tool: string; input: unknown; result: string | null; isError: boolean }
// プロンプトの後に Claude がしたことの1つ。順に、発言、thinking、秘匿された
// thinking、ツール呼び出し。
export type Step = { kind: 'text'; text: string } | { kind: 'thinking'; text: string } | { kind: 'redacted' } | { kind: 'call'; call: Call }
// 会話の1往復。本人のプロンプトと、その後に Claude がしたこと。`reply` は
// Claude の最後の発言の steps での位置(無ければ -1)で、それ以外が途中経過。
export type Turn = { prompt: string; steps: Step[]; reply: number }
export type View = {
  open: boolean
  // 見ているページ(Claude の発言から次の発言まで)の、会話の頭からの位置。null
  // なら最新のページで、会話が進むとついていく。前の版の状態には無い。
  at?: number | null
  // ページの数。
  total: number
  // 末尾までスクロールしていて、ページが伸びたらついていくか。
  follow: boolean
  // 長いプロンプトを全部見せるか。
  prompt?: boolean
  // 見せているツール呼び出しの入力と結果(`ターン:位置:input|result`)。既定は
  // 見出しの行だけ。前の版の状態には無い。
  segments?: string[]
  // トランスクリプトの行から最後に送った位置。同じ行をもう一度押したら閉じる。
  target: string | null
  version: number
  note: string | null
}

declare module 'claude-code' {
  interface PluginState {
    // marks は、トランスクリプトの途中の発言が変わるたびに上がる版。
    peek: { pane: View; marks: number }
  }
}
