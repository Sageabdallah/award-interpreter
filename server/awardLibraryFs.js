// fs-based award library loader for Node. The app's own loader
// (src/domain/awardLibrary/index.js) uses Vite's import.meta.glob and CANNOT be
// imported by the server — this is the server-side equivalent.
import fs from 'node:fs'
import path from 'node:path'

/**
 * @returns {Array<{ awardCode: string, industry: string, parsedAward: object, source: object }>}
 */
export function loadAwardLibraryFs(libraryDir, industry = 'healthcare') {
  const dir = path.join(libraryDir, industry)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      return { awardCode: name.replace('.json', ''), industry, ...entry }
    })
}
