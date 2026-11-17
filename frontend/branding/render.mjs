/**
 * Renders the branding sources to PNG with the locally installed Chrome
 * (headless; no extra packages). Usage: npm run og:thumbnail
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const chrome = process.env.CHROME_BIN ?? 'google-chrome'
const here = import.meta.dirname
const jobs = [
  ['og-thumbnail.html', '../public/og-thumbnail.png', 1200, 630],
  ['apple-touch-icon.html', '../public/apple-touch-icon.png', 180, 180],
]
for (const [src, out, w, h] of jobs) {
  const profile = mkdtempSync(join(tmpdir(), 'ebms-brand-'))
  const r = spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`, `--screenshot=${join(here, out)}`, `file://${join(here, src)}`,
  ], { encoding: 'utf8' })
  rmSync(profile, { recursive: true, force: true })
  if (r.status !== 0) {
    console.error(r.stderr)
    process.exit(1)
  }
  console.log(`${out} (${w}×${h})`)
}

// WhatsApp may skip previews for images over ~300 KB: reduce the thumbnail to a
// 256-colour dithered PNG (visually identical for this flat design) when Pillow exists.
const og = join(here, '../public/og-thumbnail.png')
const q = spawnSync('python3', ['-c', `from PIL import Image
im = Image.open(${JSON.stringify(og)}).convert('RGB')
im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(${JSON.stringify(og)}, optimize=True)`])
const kb = Math.round(statSync(og).size / 1024)
if (q.status !== 0) console.warn('Pillow not available: thumbnail left uncompressed')
console.log(`og-thumbnail.png: ${kb} KB${kb > 300 ? ' — WARNING: over 300 KB, WhatsApp may not show it' : ''}`)

