import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function collector() {
  const lines = []
  return {lines, write: message => lines.push(message), text: () => lines.join('')}
}

/** Creates a temporary folder with the given files ({relativePath: content}). */
export function tempTree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pt-pt-lint-'))
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative)
    mkdirSync(path.dirname(file), {recursive: true})
    writeFileSync(file, content)
  }
  return root
}
