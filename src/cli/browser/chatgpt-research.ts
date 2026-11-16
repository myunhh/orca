import type {
  BrowserClickResult,
  BrowserEvalResult,
  BrowserFillResult
} from '../../shared/browser/runtime/runtime-browser-contracts'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { writeStdoutLine } from '../stdout-line'
import { getBrowserCommandTarget } from './browser-command-target'
import { composeResearchPrompt } from './research-prompt'

async function researchTarget({ flags, cwd, client }: HandlerContext) {
  getRequiredStringFlag(flags, 'page')
  const expected = getRequiredStringFlag(flags, 'expect-url')
  let url: URL
  try {
    url = new URL(expected)
  } catch {
    throw new RuntimeClientError('invalid_argument', '--expect-url must be an absolute ChatGPT URL')
  }
  if (url.origin !== 'https://chatgpt.com' || url.username || url.password) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Research commands require https://chatgpt.com'
    )
  }
  return getBrowserCommandTarget(flags, cwd, client)
}

export const CHATGPT_RESEARCH_HANDLERS: Record<string, CommandHandler> = {
  'research prepare': async ({ flags, cwd, json }) => {
    const result = await composeResearchPrompt(flags, cwd)
    writeStdoutLine(json ? JSON.stringify(result, null, 2) : result.prompt)
  },
  'research fill': async (context) => {
    const element = getRequiredStringFlag(context.flags, 'element')
    const composed = await composeResearchPrompt(context.flags, context.cwd)
    const target = await researchTarget(context)
    const response = await context.client.call<BrowserFillResult>('browser.fill', {
      ...target,
      element,
      value: composed.prompt
    })
    printResult(
      {
        ...response,
        result: {
          ...response.result,
          skillFiles: composed.skillFiles,
          promptCharacters: composed.prompt.length,
          submitted: false
        }
      },
      context.json,
      (result) =>
        `Filled research prompt (${result.promptCharacters} characters, ${result.skillFiles.length} skills). Not submitted.`
    )
  },
  'research submit': async (context) => {
    const element = getRequiredStringFlag(context.flags, 'element')
    const target = await researchTarget(context)
    const response = await context.client.call<BrowserClickResult>('browser.click', {
      ...target,
      element
    })
    printResult(
      response,
      context.json,
      () =>
        'Clicked the selected submit control once. Observe ChatGPT for acceptance and completion; do not resend on silence.'
    )
  },
  'research read': async (context) => {
    const selector = getRequiredStringFlag(context.flags, 'selector')
    const target = await researchTarget(context)
    const expression = `(() => {
      const matches = document.querySelectorAll(${JSON.stringify(selector)});
      if (matches.length !== 1) throw new Error('Research answer selector must match exactly one element');
      const answer = matches[0];
      const text = answer instanceof HTMLElement ? answer.innerText : answer.textContent;
      if (!text || !text.trim()) throw new Error('Selected research answer is empty');
      const links = Array.from(answer.querySelectorAll('a[href]'))
        .map(link => ({ text: link.textContent, url: link.href }));
      return JSON.stringify({ text, links });
    })()`
    const response = await context.client.call<BrowserEvalResult>('browser.eval', {
      ...target,
      expression
    })
    printResult(response, context.json, (result) => result.result)
  }
}
