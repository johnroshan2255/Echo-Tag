// Remove <script> lines that mention any of the given needles from an HTML file, in place.
//   node tools/package/strip-sdk.mjs <file.html> <needle> [<needle>...]
import { readFileSync, writeFileSync } from 'node:fs'
const [file, ...needles] = process.argv.slice(2)
if (!file || needles.length === 0) throw new Error('usage: strip-sdk.mjs <file.html> <needle>...')
const kept = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => !(l.includes('<script') && needles.some((n) => l.includes(n))))
writeFileSync(file, kept.join('\n'))
