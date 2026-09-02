// Build the CrazyGames submission zip: portal-neutral (Poki SDK stripped), chat ON
// (CrazyGames allows chat as long as it is moderated — the server masks profanity in
// Echo-Tag-Shared/src/chat/profanity.ts), and checked against the CrazyGames upload
// limits (docs.crazygames.com/requirements/intro): ≤50 MB initial download, ≤250 MB
// total, ≤1,500 files.
//
//   npm run package:crazygames   →  echo-tag-crazygames.zip
import { execSync } from 'node:child_process'
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const DIST = join(ROOT, 'Echo-Tag-Frontend/dist')
const STAGE = join(ROOT, '.tmp-crazygames')
const ZIP = join(ROOT, 'echo-tag-crazygames.zip')
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })

// 1. Build with chat enabled (VITE_CHAT unset → chat chunk included).
run('npm run build', { env: { ...process.env, VITE_CHAT: undefined } })

// 2. Stage a copy and strip the Poki SDK <script> — CrazyGames rejects competing-portal
//    branding/SDKs (FAQ → "Monetization eligibility").
rmSync(STAGE, { recursive: true, force: true })
cpSync(DIST, STAGE, { recursive: true })
const index = join(STAGE, 'index.html')
writeFileSync(index, readFileSync(index, 'utf8').split('\n').filter((l) => !l.includes('poki-sdk')).join('\n'))

// 3. Drop source maps and precompressed twins (the portal serves its own compression).
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
for (const f of walk(STAGE)) if (/\.(map|br|gz)$/.test(f)) rmSync(f)

// 4. Zip and report against the CrazyGames limits.
rmSync(ZIP, { force: true })
run(`cd "${STAGE}" && zip -qr "${ZIP}" .`)
const files = walk(STAGE)
const totalBytes = files.reduce((n, f) => n + statSync(f).size, 0)
const mb = (b) => (b / 1e6).toFixed(1) + ' MB'
const ok = (cond) => (cond ? 'ok' : '!! OVER LIMIT')
console.log(`\necho-tag-crazygames.zip (portal-neutral, chat ON with server-side profanity filter)`)
console.log(`  zip size       ${mb(statSync(ZIP).size)}`)
console.log(`  unpacked total ${mb(totalBytes)}   (limit 250 MB) ${ok(totalBytes <= 250e6)}`)
console.log(`  file count     ${files.length}   (limit 1500)   ${ok(files.length <= 1500)}`)
console.log(`  initial download must be ≤ 50 MB — total is ${mb(totalBytes)}, so ${ok(totalBytes <= 50e6)}`)
// 5. Multiplayer origin: Vite reads .env then .env.production for `vite build`; the
//    packaged game must point at the deployed wss server, not the dev fallback.
const envVal = (file) => {
  try {
    return readFileSync(join(ROOT, 'Echo-Tag-Frontend', file), 'utf8').match(/^VITE_WS_ORIGIN=(.+)$/m)?.[1]?.trim()
  } catch {
    return undefined
  }
}
const origin = envVal('.env.production') ?? envVal('.env')
const bundled = origin && files.some((f) => f.endsWith('.js') && readFileSync(f, 'utf8').includes(origin))
if (!origin || /localhost|127\.0\.0\.1|^ws:|^http:/.test(origin) || !bundled) {
  console.log(
    `\n!! VITE_WS_ORIGIN is ${origin ?? 'unset'}${bundled ? '' : ' (not found in the bundle)'}: QUICK MATCH / HOST / JOIN\n` +
      '   (and chat) will fail on CrazyGames. PLAY (bots) still works. Set a wss:// origin in\n' +
      '   Echo-Tag-Frontend/.env.production and rebuild — see docs/POKI_DEPLOY.md.',
  )
} else {
  console.log(`  multiplayer    ${origin} (bundled) ok`)
}
rmSync(STAGE, { recursive: true, force: true })
