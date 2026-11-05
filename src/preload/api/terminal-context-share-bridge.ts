import { ipcRenderer } from 'electron'
import type {
  TerminalContextSummaryCancellation,
  TerminalContextSummaryRequest,
  TerminalContextSummaryResult
} from '../../shared/terminal-context-share/terminal-context-share-types'

export type TerminalContextShareApi = {
  summarize: (args: TerminalContextSummaryRequest) => Promise<TerminalContextSummaryResult>
  cancel: (args: TerminalContextSummaryCancellation) => Promise<void>
}

export const terminalContextShareApi: TerminalContextShareApi = {
  summarize: (args) => ipcRenderer.invoke('terminalContext:summarize', args),
  cancel: (args) => ipcRenderer.invoke('terminalContext:cancel', args)
}
