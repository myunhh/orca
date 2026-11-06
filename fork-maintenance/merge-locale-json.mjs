// Git merge driver for the locale catalogs: usage `merge-locale-json.mjs %O %A %B`.
// Keys either side added are kept; upstream wins when both changed the same text.
import { readFileSync, writeFileSync } from 'node:fs'

const [basePath, oursPath, theirsPath] = process.argv.slice(2)
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function mergeValues(base, ours, theirs) {
  if (isObject(ours) && isObject(theirs)) {
    return mergeObjects(isObject(base) ? base : {}, ours, theirs)
  }
  if (same(ours, theirs) || same(theirs, base)) {
    return ours
  }
  return theirs
}

function mergeObjects(base, ours, theirs) {
  const merged = {}
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const inOurs = key in ours
    const inTheirs = key in theirs
    if (inOurs && inTheirs) {
      merged[key] = mergeValues(base[key], ours[key], theirs[key])
    } else if (inOurs && !(key in base)) {
      merged[key] = ours[key]
    } else if (inTheirs) {
      merged[key] = theirs[key]
    }
    // Present in base but missing on one side: that side deleted it, so it stays deleted.
  }
  return merged
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const merged = mergeObjects(read(basePath), read(oursPath), read(theirsPath))
writeFileSync(oursPath, `${JSON.stringify(merged, null, 2)}\n`)
