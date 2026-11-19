// pt-pt-lint-disable-file: fixtures quote Brazilian forms on purpose.
import {spawnSync} from 'node:child_process'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {Readable} from 'node:stream'
import {afterEach, describe, expect, it} from 'vitest'
import {readStdin, run} from './cli.mjs'
import {loadConfig, matchesGlob} from './config.mjs'
import {listFiles} from './files.mjs'
import {collector, tempTree} from './test-helpers.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})
const tree = files => {
  const root = tempTree(files)
  roots.push(root)
  return root
}

async function cli(argv, options = {}) {
  const out = collector()
  const err = collector()
  const code = await run(argv, {
    cwd: process.cwd(),
    env: {},
    stdin: async () => '',
    writeOut: out.write,
    writeErr: err.write,
    ...options,
  })
  return {code, out: out.text(), err: err.text()}
}

describe('matchesGlob', () => {
  it.each([
    ['src/a.ts', 'src/**', true],
    ['src/deep/a.ts', 'src/**/*.ts', true],
    ['a.ts', '**/*.ts', true],
    ['src/a.ts', '*.ts', false],
    ['docs/a.md', 'docs/?.md', true],
    ['docs/ab.md', 'docs/?.md', false],
  ])('%s against %s', (file, glob, expected) => expect(matchesGlob(file, glob)).toBe(expected))
})

describe('loadConfig', () => {
  it('finds the nearest config upwards', () => {
    const root = tree({'.pt-pt-lint.json': '{"allow": ["tela"]}', 'a/b/c.md': ''})
    expect(loadConfig(path.join(root, 'a', 'b'))).toEqual({
      allow: ['tela'],
      disable: [],
      ignore: [],
      root,
    })
  })

  it('fills missing fields', () => {
    const root = tree({'.pt-pt-lint.json': '{}'})
    expect(loadConfig(root)).toEqual({allow: [], disable: [], ignore: [], root})
  })

  it('returns defaults without a config', () => {
    const root = tree({'a.md': ''})
    expect(loadConfig(root, {stopAt: root})).toMatchObject({allow: [], ignore: []})
  })
})

describe('listFiles', () => {
  it('lists supported text files and skips ignored, binary, huge and generated ones', () => {
    const root = tree({
      'README.md': 'texto',
      'src/app.ts': 'x',
      'src/style.css': 'x',
      'node_modules/x/a.md': 'x',
      'dist/a.js': 'x',
      'pnpm-lock.yaml': 'x',
      'img.md': 'a\0b',
      'big.md': 'a'.repeat(1_100_000),
      'public/vendor.js': 'a'.repeat(30_000),
      'src/long.md': 'linha\n'.repeat(5000),
      'docs/skip.md': 'x',
    })
    const files = listFiles(root, [], {ignore: ['docs/**']})
    expect(files.sort()).toEqual(['README.md', 'src/app.ts', 'src/long.md'])
  })

  it('walks the given paths outside Git', () => {
    const root = tree({'a/b.md': 'x', 'c.md': 'x'})
    expect(listFiles(root, ['a', 'c.md', 'missing.md'], {ignore: []})).toEqual(['a/b.md', 'c.md'])
  })

  it('uses git when the folder is a repository', () => {
    const root = tree({'a.md': 'x', 'untracked.md': 'x'})
    spawnSync('git', ['init', '-q'], {cwd: root})
    spawnSync('git', ['add', 'a.md'], {cwd: root})
    expect(listFiles(root, [], {ignore: []})).toEqual(['a.md'])
    expect(listFiles(root, ['a.md', 'missing.md'], {ignore: []})).toEqual(['a.md'])
  })

  it('asks git in several calls when the paths would overflow one command line', () => {
    const root = tree({'a.md': 'x', 'docs/b.md': 'x', 'untracked.md': 'x'})
    spawnSync('git', ['init', '-q'], {cwd: root})
    spawnSync('git', ['add', 'a.md', 'docs/b.md'], {cwd: root})
    // A merge commit: thousands of staged paths. Windows refuses a command line over 32,767 characters.
    const many = Array.from(
      {length: 5000},
      (_, i) => `apps/web/app/[locale]/portal/section-${i}/components/a file-${i}.md`,
    )
    const calls = []
    const spawn = (command, args, options) => {
      calls.push([command, ...args].join(' ').length)
      return spawnSync(command, args, options)
    }
    const paths = ['a.md', ...many, 'docs', 'docs/b.md']
    expect(listFiles(root, paths, {ignore: []}, {spawn})).toEqual(['a.md', 'docs/b.md'])
    expect(calls.length).toBeGreaterThan(1)
    for (const length of calls) expect(length).toBeLessThan(32_767)
    expect(calls.reduce((sum, length) => sum + length, 0)).toBeGreaterThan(32_767)
  })

  it('walks the paths when git fails for any of the calls', () => {
    const root = tree({'a.md': 'x', 'b.md': 'x'})
    const many = Array.from({length: 2000}, (_, i) => `missing/a rather long folder name/${i}.md`)
    let calls = 0
    const spawn = () => ({status: calls++ === 0 ? 0 : 128, stdout: 'b.md\0'})
    expect(listFiles(root, ['a.md', ...many], {ignore: []}, {spawn})).toEqual(['a.md'])
    expect(calls).toBe(2)
  })
})

describe('run', () => {
  it('prints usage', async () => {
    expect((await cli(['--help'])).out).toContain('Uso: pt-pt-lint')
    expect((await cli(['--bogus'])).code).toBe(2)
  })

  it('reports problems and fails only on fixable ones by default', async () => {
    const root = tree({'a.md': 'O usuário não abriu a tela.\n', 'b.md': 'Não abriu a tela.\n'})
    const result = await cli([], {cwd: root})
    expect(result.code).toBe(1)
    expect(result.out).toContain('a.md:1:3  «usuário» → «utilizador»  [br, corrigível]')
    expect(result.out).toContain('b.md:1:13  «tela» → «ecrã»  [br, rever]')
    expect(result.out).toContain('3 problemas em 2 ficheiros (1 corrigível com --fix)')
    expect((await cli(['b.md'], {cwd: root})).code).toBe(0)
    expect((await cli(['--strict', 'b.md'], {cwd: root})).code).toBe(1)
  })

  it('fixes files in place', async () => {
    const root = tree({'a.md': 'O usuário não abriu a tela.\n'})
    const result = await cli(['--fix'], {cwd: root})
    expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('O utilizador não abriu a tela.\n')
    expect(result.out).toContain('1 correção aplicada')
    expect(result.code).toBe(0)
  })

  it('writes GitHub annotations and JSON', async () => {
    const root = tree({'a.md': 'O usuário não abriu a tela.\n'})
    const github = await cli([], {cwd: root, env: {GITHUB_ACTIONS: 'true'}})
    expect(github.out).toContain(
      '::error file=a.md,line=1,col=3,title=pt-PT (br)::«usuário» → «utilizador»',
    )
    expect(github.out).toContain(
      '::warning file=a.md,line=1,col=23,title=pt-PT (br)::«tela» → «ecrã»',
    )
    const json = JSON.parse((await cli(['--format', 'json'], {cwd: root})).out)
    expect(json[0]).toMatchObject({file: 'a.md', match: 'usuário', fixable: true})
  })

  it('honours the repository config', async () => {
    const root = tree({
      '.pt-pt-lint.json': '{"allow": ["tela"], "ignore": ["old/**"]}',
      'a.md': 'Não há tela.\n',
      'old/a.md': 'O usuário não.\n',
    })
    const result = await cli([], {cwd: root})
    expect(result.out).toContain('Sem problemas')
    expect(result.code).toBe(0)
  })

  it('reports an invalid config', async () => {
    const root = tree({'.pt-pt-lint.json': '{', 'a.md': 'x'})
    const result = await cli([], {cwd: root})
    expect(result.code).toBe(2)
    expect(result.err).toContain('.pt-pt-lint.json')
  })

  it('lints standard input', async () => {
    const result = await cli(['--stdin', '--stdin-path', 'pt.json'], {
      stdin: async () => '{"a": "Salvar"}',
    })
    expect(result.out).toContain('pt.json:1:8  «Salvar» → «Guardar»')
  })

  it('lints unnamed standard input and reads streams', async () => {
    const result = await cli(['--stdin'], {stdin: async () => 'O usuário não.'})
    expect(result.out).toContain('<stdin>:1:3')
    expect(await readStdin(Readable.from(['Olá ', Buffer.from('mundo')]))).toBe('Olá mundo')
  })

  it('prints the hook decision', async () => {
    const content = `O usuário não existe. ${Date.now()} ${Math.random()}`
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: {file_path: 'a.md', content},
    })
    const result = await cli(['--hook', 'pre-tool-use'], {stdin: async () => input})
    expect(JSON.parse(result.out).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('runs the Claude Code hooks', async () => {
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: {command: 'ls'},
    })
    const result = await cli(['--hook', 'pre-tool-use'], {stdin: async () => input})
    expect(result).toEqual({code: 0, out: '', err: ''})
    expect((await cli(['--hook', 'nope'], {stdin: async () => '{}'})).code).toBe(2)
  })

  it('writes files only when they change', async () => {
    const root = tree({'a.md': 'Não há nada.\n'})
    writeFileSync(path.join(root, 'a.md'), 'Não há nada.\n')
    expect((await cli(['--fix'], {cwd: root})).out).toContain('Sem problemas')
  })
})
