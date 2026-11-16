import { WORKBENCH_MAX_DISPLAY_TEXT_CHARS } from '../../shared/workbench-window/workbench-window-types'

const MAX_ID = 512

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID
}

export function isText(value: unknown, max = WORKBENCH_MAX_DISPLAY_TEXT_CHARS): value is string {
  return typeof value === 'string' && value.length <= max
}

export function isNullableText(value: unknown, max = WORKBENCH_MAX_DISPLAY_TEXT_CHARS): boolean {
  return value === null || isText(value, max)
}
