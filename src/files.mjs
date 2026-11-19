import {spawnSync} from 'node:child_process'
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {matchesGlob} from './config.mjs'
import {SUPPORTED_EXTENSIONS} from './regions.mjs'

const MAX_BYTES = 1_000_000
// Per git call; well under the 32,767 characters of a Windows command line.
const MAX_ARGS_LENGTH = 16_000
const SKIP_DIRS = new Set(['node_modules', '.git'])
export const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/.turbo/**',
  '**/vendor/**',
  '**/storage/**',
  '**/*.min.js',
  '**/*.map',
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/composer.lock',
  '**/.pt-pt-lint.json',
]

/** Bundled or minified code: long and with very long lines on average. Nobody writes text there. */
function isMinified(text) {
  return text.length > 20_000 && text.length / text.split('\n').length > 300
}

function walk(root, relative, out) {
  const absolute = path.join(root, relative)
  if (!existsSync(absolute)) return
  if (!statSync(absolute).isDirectory()) {
    out.push(relative.replace(/\\/g, '/'))
    return
  }
  for (const entry of readdirSync(absolute)) {
    if (!SKIP_DIRS.has(entry)) walk(root, relative ? `${relative}/${entry}` : entry, out)
  }
}

/**
 * Splits `paths` into groups that each fit one command line. `git ls-files` takes paths only as
 * arguments, and Windows refuses a command line over 32,767 characters, which the staged files
 * of a merge commit exceed. Always returns at least one group.
 * @param {string[]} paths
 */
function chunkByLength(paths) {
  const chunks = [[]]
  let length = 0
  for (const item of paths) {
    // Three more per path: the separating space and the quotes Windows may add.
    const cost = item.length + 3
    if (length > 0 && length + cost > MAX_ARGS_LENGTH) {
      chunks.push([])
      length = 0
    }
    chunks.at(-1).push(item)
    length += cost
  }
  return chunks
}

/**
 * Text files to check, relative to `root`: tracked files in a Git repository, otherwise every file.
 * @param {string} root
 * @param {string[]} paths limit to these files or folders
 * @param {{ignore: string[], root?: string}} config
 * @param {{spawn?: typeof spawnSync}} [options]
 */
export function listFiles(root, paths, config, options = {}) {
  const spawn = options.spawn ?? spawnSync
  let files = []
  const tracked = new Set()
  const inGit = chunkByLength(paths).every(chunk => {
    const git = spawn('git', ['ls-files', '-z', '--', ...chunk], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
    if (git.status !== 0) return false
    for (const file of git.stdout.split('\0')) if (file) tracked.add(file)
    return true
  })
  if (inGit) files = [...tracked]
  else for (const target of paths.length > 0 ? paths : ['']) walk(root, target, files)
  const configRoot = config.root ?? root
  return files.filter(file => {
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) return false
    if (DEFAULT_IGNORE.some(glob => matchesGlob(file, glob))) return false
    const fromConfig = path.relative(configRoot, path.join(root, file)).replace(/\\/g, '/')
    if (config.ignore.some(glob => matchesGlob(fromConfig, glob))) return false
    const absolute = path.join(root, file)
    if (!existsSync(absolute) || statSync(absolute).size > MAX_BYTES) return false
    const text = readFileSync(absolute, 'utf8')
    return !text.includes('\0') && !isMinified(text)
  })
}
