import {spawnSync} from 'node:child_process'
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {matchesGlob} from './config.mjs'
import {SUPPORTED_EXTENSIONS} from './regions.mjs'

const MAX_BYTES = 1_000_000
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
 * Text files to check, relative to `root`: tracked files in a Git repository, otherwise every file.
 * @param {string} root
 * @param {string[]} paths limit to these files or folders
 * @param {{ignore: string[], root?: string}} config
 * @param {{spawn?: typeof spawnSync}} [options]
 */
export function listFiles(root, paths, config, options = {}) {
  const spawn = options.spawn ?? spawnSync
  const git = spawn('git', ['ls-files', '-z', '--', ...paths], {cwd: root, encoding: 'utf8'})
  let files = []
  if (git.status === 0) files = git.stdout.split('\0').filter(Boolean)
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
