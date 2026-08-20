import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
const PORT = 4185
const URL = `http://127.0.0.1:${PORT}/`
const [x = '420', y = '300', w = '360', h = '240'] = process.argv.slice(2)
const OUT = 'tools/check/screenshots/crop-1to1.png'
const p = spawn('npx',['vite','preview','--port',String(PORT),'--strictPort','--host','127.0.0.1'],{cwd:'Echo-Tag-Frontend',stdio:'ignore'})
for (let i=0;i<80;i++){ try { if ((await fetch(URL)).ok) break } catch {} await new Promise(r=>setTimeout(r,150)) }
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--hide-scrollbars'] })
const page = await (await b.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:2 })).newPage()
await page.goto(URL, { waitUntil:'domcontentloaded' })
await page.waitForFunction(() => document.documentElement.dataset.boot === 'ready')
await page.click('#play')
await page.waitForFunction(() => document.documentElement.dataset.game === 'running')
await page.waitForTimeout(4000)
await page.screenshot({ path: OUT, clip: { x: Number(x), y: Number(y), width: Number(w), height: Number(h) } })
console.log(`crop -> ${OUT}  (${w}x${h} CSS px at dpr 2)`)
console.log(await page.evaluate(() => (globalThis as any).__echoTag))
await b.close(); p.kill('SIGTERM')
