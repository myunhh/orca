import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORCAD_TEMPLATE_MANIFEST_FILENAME } from '../../shared/orcad-artifacts'
import { getOrcadTemplateCandidates } from './orcad-artifact-materializer'

/** Identity of the template this app would deploy; a dev build keeps its version across rebuilds. */
export function orcadTemplateFingerprint(): string {
  const found = getOrcadTemplateCandidates().find((candidate) => existsSync(candidate))
  if (!found) {
    return 'none'
  }
  try {
    const manifest = readFileSync(join(found, ORCAD_TEMPLATE_MANIFEST_FILENAME))
    return createHash('sha256').update(manifest).digest('hex').slice(0, 16)
  } catch {
    return 'unreadable'
  }
}
