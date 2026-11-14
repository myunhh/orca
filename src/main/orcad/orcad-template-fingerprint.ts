import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ORCAD_TEMPLATE_MANIFEST_FILENAME } from '../../shared/orcad-artifacts'
import { getOrcadTemplateCandidates } from './orcad-artifact-materializer'

/** Identity of the template this app would deploy; a dev build keeps its version across rebuilds. */
export async function orcadTemplateFingerprint(): Promise<string> {
  for (const candidate of getOrcadTemplateCandidates()) {
    try {
      await access(candidate)
    } catch {
      continue
    }
    try {
      const manifest = await readFile(join(candidate, ORCAD_TEMPLATE_MANIFEST_FILENAME))
      return createHash('sha256').update(manifest).digest('hex').slice(0, 16)
    } catch {
      return 'unreadable'
    }
  }
  return 'none'
}
