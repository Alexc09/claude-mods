// Writes one standalone SVG per mascot (the working phase, animated) into this folder.
// Run from the plugin folder: node --experimental-strip-types mascots/build.mjs
import { writeFileSync } from 'node:fs'
import { MASCOTS, mascotSvg } from '../hooks/mascots.ts'

const dir = new URL('.', import.meta.url)
for (const m of MASCOTS) writeFileSync(new URL(`${m.id}.svg`, dir), mascotSvg(m.id, 'working') + '\n')
console.log(`Wrote ${MASCOTS.length} mascots: ${MASCOTS.map(m => m.id).join(', ')}`)
