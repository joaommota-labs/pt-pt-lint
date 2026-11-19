// pt-pt-lint-disable-file: fixtures quote Brazilian forms on purpose.
import {spawnSync} from 'node:child_process'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {fixStaged} from './staged.mjs'
import {collector, tempTree} from './test-helpers.mjs'

// Windows refuses a command line over 32,767 characters (spawnSync git ENAMETOOLONG).
const WINDOWS_COMMAND_LINE_LIMIT = 32_767
const commandLineLength = args => ['git', ...args].join(' ').length

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

function repo(files) {
  const root = tempTree(files)
  roots.push(root)
  const git = (...args) => {
    const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'})
    expect(result.stderr).toBe('')
    return result.stdout
  }
  git('init', '-q')
  git('config', 'core.autocrlf', 'false')
  return {root, git, read: file => readFileSync(path.join(root, file), 'utf8')}
}

function io(cwd) {
  const out = collector()
  return {
    out,
    cwd,
    env: {},
    stdin: async () => '',
    writeOut: out.write,
    writeErr: out.write,
  }
}

describe('fixStaged', () => {
  it('does nothing without staged files', async () => {
    const {root} = repo({'a.md': 'O usuário não abriu.\n'})
    const streams = io(root)
    expect(await fixStaged(streams)).toBe(0)
    expect(streams.out.text()).toBe('')
  })

  it('fixes the staged files and stages only what the fix changed', async () => {
    const {root, git, read} = repo({
      'fixed.md': 'O usuário não abriu.\n',
      'partly staged.md': 'O usuário não abriu.\n',
      'clean.md': 'Não há nada.\n',
      'unstaged.md': 'O usuário não abriu.\n',
    })
    git('add', 'fixed.md', 'partly staged.md', 'clean.md')
    writeFileSync(path.join(root, 'partly staged.md'), 'O usuário não abriu.\n\nPor acabar.\n')

    expect(await fixStaged(io(root))).toBe(0)

    expect(read('fixed.md')).toBe('O utilizador não abriu.\n')
    expect(git('show', ':fixed.md')).toBe('O utilizador não abriu.\n')
    // It already had changes outside the index: the fix stays in the working tree.
    expect(read('partly staged.md')).toBe('O utilizador não abriu.\n\nPor acabar.\n')
    expect(git('show', ':partly staged.md')).toBe('O usuário não abriu.\n')
    expect(read('unstaged.md')).toBe('O usuário não abriu.\n')
    expect(git('diff', '--cached', '--name-only').trim().split('\n').sort()).toEqual([
      'clean.md',
      'fixed.md',
      'partly staged.md',
    ])
  })

  it('returns the exit code of the check', async () => {
    const {root, git} = repo({'a.md': 'Não abriu a tela.\n', 'b.md': 'Abra o arquivo.\n'})
    git('add', 'a.md')
    expect(await fixStaged(io(root))).toBe(0)
    git('add', 'b.md')
    const run = async argv => (argv.includes('b.md') ? 1 : 0)
    expect(await fixStaged(io(root), {run})).toBe(1)
  })

  it('never passes the file list to git as arguments, however many files are staged', async () => {
    const staged = Array.from(
      {length: 5000},
      (_, i) => `apps/web/app/[locale]/portal/section-${i}/components/a file-${i}.md`,
    )
    expect(commandLineLength(['add', '--', ...staged])).toBeGreaterThan(WINDOWS_COMMAND_LINE_LIMIT)
    const alreadyUnstaged = staged[1]
    const fixedByRun = [staged[0], staged[4999]]
    const calls = []
    let ran = null
    const git = (args, input) => {
      calls.push({args, input})
      if (args[0] === 'add') return ''
      const names = args.includes('--cached')
        ? staged
        : // Unstaged changes: one from before, one outside the commit and, after the fix, the fixed ones.
          [alreadyUnstaged, 'not-staged.md', ...(ran ? fixedByRun : [])]
      return names.map(name => `${name}\0`).join('')
    }
    const run = async argv => {
      ran = argv
      return 1
    }

    expect(await fixStaged(io('.'), {git, run})).toBe(1)

    expect(ran).toEqual(['--fix', ...staged])
    for (const call of calls) expect(commandLineLength(call.args)).toBeLessThan(200)
    expect(calls.map(call => call.args[0])).toEqual(['diff', 'diff', 'diff', 'add'])
    expect(calls[3]).toEqual({
      args: ['add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      input: `${fixedByRun[0]}\0${fixedByRun[1]}\0`,
    })
  })
})
