import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { callMock, runtimeClientConstructorMock, serveOrcaAppMock, getDefaultUserDataPathMock } =
  vi.hoisted(() => ({
    callMock: vi.fn(),
    runtimeClientConstructorMock: vi.fn(),
    serveOrcaAppMock: vi.fn(),
    getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data')
  }))

vi.mock('../runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('../index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

import { BROWSER_EXPECT_URL_RUNTIME_CAPABILITY } from '../../shared/browser/runtime/browser-runtime-capabilities'
import { main } from '../index'
import { okFixture } from '../test-fixtures'

const URL = 'https://chatgpt.com/c/research-conversation'

beforeEach(() => {
  callMock.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.exitCode = undefined
  callMock.mockImplementation(async (method: string) =>
    method === 'status.get'
      ? okFixture('status', { capabilities: [BROWSER_EXPECT_URL_RUNTIME_CAPABILITY] })
      : okFixture('result', { filled: '@e3' })
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

it('fills the pinned conversation without submitting it', async () => {
  await main(
    [
      'research',
      'fill',
      '--page',
      'research-page',
      '--expect-url',
      URL,
      '--element',
      '@e3',
      '--prompt',
      'Find evidence for this claim.',
      '--json'
    ],
    '/tmp/not-a-git-worktree'
  )
  expect(callMock).toHaveBeenCalledWith('browser.fill', {
    page: 'research-page',
    expectUrl: URL,
    element: '@e3',
    value: 'Find evidence for this claim.'
  })
  expect(callMock.mock.calls.some(([method]) => method === 'browser.click')).toBe(false)
  expect(process.exitCode).toBeUndefined()
})

it.each([
  ['fill', '--element', '@e3', '--prompt', 'Research this.'],
  ['submit', '--element', '@e4'],
  ['read', '--selector', '#answer']
])('refuses %s outside the ChatGPT origin before any browser call', async (...command) => {
  await main(
    [
      'research',
      ...command,
      '--page',
      'research-page',
      '--expect-url',
      'https://chatgpt.com.evil.test/',
      '--json'
    ],
    '/tmp/not-a-git-worktree'
  )
  expect(callMock).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(1)
})

it('refuses submission on a runtime that cannot enforce the conversation URL', async () => {
  callMock.mockResolvedValue(okFixture('status', { capabilities: [] }))
  await main(
    [
      'research',
      'submit',
      '--page',
      'research-page',
      '--expect-url',
      URL,
      '--element',
      '@e4',
      '--json'
    ],
    '/tmp/not-a-git-worktree'
  )
  expect(callMock.mock.calls.map(([method]) => method)).toEqual(['status.get'])
  expect(process.exitCode).toBe(1)
})
