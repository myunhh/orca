import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { REPEATED_FLAG_SEPARATOR } from '../args'
import { composeResearchPrompt } from './research-prompt'

let directory: string

beforeEach(async () => {
  vi.stubEnv('ORCA_CLI_CWD', '')
  directory = await mkdtemp(join(tmpdir(), 'orca-research-'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

it('inlines only the selected skill documents, once, with the actual question', async () => {
  await mkdir(join(directory, 'review'))
  await writeFile(join(directory, 'review', 'SKILL.md'), 'Check every claim against evidence.')
  await writeFile(join(directory, 'review', 'secret.txt'), 'PRIVATE DO NOT SEND')
  await writeFile(join(directory, 'question.txt'), 'Compare the two approaches.')
  const result = await composeResearchPrompt(
    new Map([
      ['prompt-file', 'question.txt'],
      ['skill', `review${REPEATED_FLAG_SEPARATOR}review/SKILL.md`]
    ]),
    directory
  )
  expect(result.prompt).toContain('Compare the two approaches.')
  expect(result.prompt.match(/Check every claim against evidence\./g)).toEqual([
    'Check every claim against evidence.'
  ])
  expect(result.prompt).not.toContain('PRIVATE DO NOT SEND')
  expect(result.skillFiles).toHaveLength(1)
})

it('refuses empty questions rather than sending skill content alone', async () => {
  await expect(composeResearchPrompt(new Map([['prompt', '  ']]), directory)).rejects.toMatchObject(
    {
      code: 'invalid_argument'
    }
  )
})

it('refuses forwarded filesystem reads but permits already composed inline prompts', async () => {
  vi.stubEnv('ORCA_CLI_CWD', '/different-machine')
  await expect(
    composeResearchPrompt(new Map([['prompt-file', 'question.txt']]), directory)
  ).rejects.toMatchObject({ code: 'invalid_environment' })
  await expect(
    composeResearchPrompt(
      new Map([['prompt', 'Question with selected skill already inlined.']]),
      directory
    )
  ).resolves.toEqual({
    prompt: 'Question with selected skill already inlined.',
    skillFiles: []
  })
})
