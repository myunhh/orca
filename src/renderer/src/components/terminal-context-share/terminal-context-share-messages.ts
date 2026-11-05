// Agent-facing text stays English: it is a prompt for the receiving agent, not UI copy.

type TerminalRef = { title: string; handle: string }

function quoteTitle(title: string): string {
  return JSON.stringify(title.replace(/\s+/g, ' ').trim() || 'terminal')
}

export function buildSharedSummaryMessage(args: {
  source: TerminalRef
  modelName: string
  summary: string
}): string {
  return [
    `Context hand-off from another Orca terminal ${quoteTitle(args.source.title)} (terminal ${args.source.handle}), summarized by ${args.modelName}:`,
    '',
    args.summary.trim(),
    '',
    `Use this as background for your work. To look at that terminal yourself: orca terminal read --terminal ${args.source.handle} --screen`
  ].join('\n')
}

export function buildSharedScreenMessage(args: { source: TerminalRef; screen: string }): string {
  return [
    `Screen snapshot from another Orca terminal ${quoteTitle(args.source.title)} (terminal ${args.source.handle}):`,
    '',
    '```text',
    args.screen.replace(/```/g, '`​``'),
    '```',
    '',
    'Use this as background for your work.'
  ].join('\n')
}

export function buildTerminalLinkNote(args: { self: TerminalRef; partner: TerminalRef }): string {
  const partner = args.partner.handle
  return [
    `You are now linked with another agent's terminal in Orca so you can coordinate.`,
    `- Your terminal: ${quoteTitle(args.self.title)} (${args.self.handle})`,
    `- Partner terminal: ${quoteTitle(args.partner.title)} (${partner})`,
    `See what the partner is doing: orca terminal read --terminal ${partner} --screen`,
    `Send the partner a message or prompt: orca terminal send --terminal ${partner} --text "<message>" --enter`,
    'Message the partner only when it helps the shared task, and check its screen first so you do not interrupt it mid-turn. No reply to this note is needed; continue your current work.'
  ].join('\n')
}
