import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { readTextOrFileFlag } from '../command-body-input'
import { getRepeatedStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

export async function composeResearchPrompt(flags: Map<string, string | boolean>, cwd: string) {
  const requestedSkills = getRepeatedStringFlag(flags, 'skill')
  if (flags.has('skill') && requestedSkills.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--skill requires a skill directory or SKILL.md path'
    )
  }
  if (process.env.ORCA_CLI_CWD && (requestedSkills.length > 0 || flags.has('prompt-file'))) {
    throw new RuntimeClientError(
      'invalid_environment',
      'Research files belong to the machine running this CLI, not the forwarded shell. ' +
        'Run research prepare on the machine holding the skills, then pass its composed text with --prompt.'
    )
  }
  const prompt = await readTextOrFileFlag(flags, cwd, 'prompt', true)
  if (!prompt?.trim()) {
    throw new RuntimeClientError('invalid_argument', 'The research prompt must not be empty')
  }
  const skills: { path: string; content: string }[] = []
  const seen = new Set<string>()
  for (const requested of requestedSkills) {
    const path = resolve(cwd, requested)
    const file = (await stat(path)).isDirectory() ? join(path, 'SKILL.md') : path
    if (basename(file) !== 'SKILL.md') {
      throw new RuntimeClientError('invalid_argument', '--skill must name a directory or SKILL.md')
    }
    const canonical = await realpath(file)
    if (seen.has(canonical)) {
      continue
    }
    const content = await readFile(canonical, 'utf8')
    if (!content.trim()) {
      throw new RuntimeClientError('invalid_argument', `Skill is empty: ${requested}`)
    }
    seen.add(canonical)
    skills.push({ path: canonical, content })
  }
  return {
    prompt:
      skills.length === 0
        ? prompt
        : [
            prompt,
            '',
            'Use the following user-selected skill content for this research task. ' +
              'The files are inlined, not uploaded. Referenced files, scripts, and local tools ' +
              'are not available unless separately supplied; do not claim to have run them.',
            ...skills.map(
              ({ path, content }) => `\nSkill source: ${JSON.stringify(path)}\n${content}`
            )
          ].join('\n'),
    skillFiles: skills.map(({ path }) => path)
  }
}
