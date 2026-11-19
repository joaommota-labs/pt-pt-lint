import {execFileSync} from 'node:child_process'
import {run as runCli} from './cli.mjs'

const names = output => output.split('\0').filter(Boolean)

/**
 * Pre-commit step: fixes the Portuguese of the staged files, stages what the fix changed and
 * returns the exit code of the check (1 when something fixable is left).
 *
 * The file list never reaches git as arguments: a merge commit stages thousands of files and
 * Windows refuses a command line over 32,767 characters (`spawnSync git ENAMETOOLONG`). Git
 * lists the changes itself and receives the paths to stage through stdin.
 *
 * @param {Parameters<typeof runCli>[1]} io
 * @param {{git?: (args: string[], input?: string) => string, run?: typeof runCli}} [options]
 * @returns {Promise<number>}
 */
export async function fixStaged(io, options = {}) {
  const git =
    options.git ??
    ((args, input) =>
      execFileSync('git', args, {
        cwd: io.cwd,
        encoding: 'utf8',
        input,
        maxBuffer: 256 * 1024 * 1024,
      }))
  const run = options.run ?? runCli

  const staged = names(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']))
  if (staged.length === 0) return 0
  const isStaged = new Set(staged)
  const unstaged = () =>
    names(git(['diff', '--name-only', '-z'])).filter(file => isStaged.has(file))

  const unstagedBefore = new Set(unstaged())
  const code = await run(['--fix', ...staged], io)
  // Stage only what the fix changed; changes that were already outside the index stay outside.
  const fixed = unstaged().filter(file => !unstagedBefore.has(file))
  if (fixed.length > 0) {
    git(
      ['add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      fixed.map(file => `${file}\0`).join(''),
    )
  }
  return code
}
