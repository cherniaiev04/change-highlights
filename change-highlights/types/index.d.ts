export type Highlight = {
  /** When the turn ended, ms since epoch. */
  at: number
  /** Files the turn changed. */
  files: string[]
  /** The model's write-up, markdown. */
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'change-highlights': {
      history: Highlight[]
      /** Index into history being shown; -1 = latest. */
      cursor: number
      isBusy: boolean
    }
  }
}
