import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'

export const CONFIG_FILE = '.pt-pt-lint.json'

/**
 * @typedef {object} Config
 * @property {string[]} allow words or expressions accepted as they are
 * @property {string[]} disable rule ids to skip
 * @property {string[]} ignore globs, relative to `root`, of files to skip
 * @property {string} root folder of the config file
 */

/**
 * Reads the nearest `.pt-pt-lint.json` from `startDir` upwards.
 * @param {string} startDir
 * @param {{stopAt?: string}} [options]
 * @returns {Config}
 */
export function loadConfig(startDir, options = {}) {
  const start = path.resolve(startDir)
  let dir = start
  for (;;) {
    const file = path.join(dir, CONFIG_FILE)
    if (existsSync(file)) {
      let raw
      try {
        raw = JSON.parse(readFileSync(file, 'utf8'))
      } catch (error) {
        throw new Error(`${file}: JSON inválido (${error.message})`)
      }
      return {
        allow: raw.allow ?? [],
        disable: raw.disable ?? [],
        ignore: raw.ignore ?? [],
        root: dir,
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir || dir === options.stopAt)
      return {allow: [], disable: [], ignore: [], root: start}
    dir = parent
  }
}

/**
 * Minimal glob: `**` crosses folders, `*` and `?` stay inside one.
 * @param {string} file relative path
 * @param {string} glob
 */
export function matchesGlob(file, glob) {
  let pattern = GLOBS.get(glob)
  if (!pattern) {
    pattern = globToRegExp(glob)
    GLOBS.set(glob, pattern)
  }
  return pattern.test(file.replace(/\\/g, '/'))
}

const GLOBS = new Map()

function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('**', i)) {
      source += '.*'
      i += 1
    } else if (c === '*') source += '[^/]*'
    else if (c === '?') source += '[^/]'
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}
