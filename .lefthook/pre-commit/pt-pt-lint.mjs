#!/usr/bin/env node
// Script do Lefthook remoto (lefthook-remote.yml): corrige o português dos
// ficheiros em stage, volta a pô-los em stage e falha se ficar algo corrigível por corrigir.
import {execFileSync} from 'node:child_process'
import {readStdin, run} from '../../src/cli.mjs'

const git = args => execFileSync('git', args, {encoding: 'utf8'})
const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  .split('\0')
  .filter(Boolean)

if (staged.length > 0) {
  const before = git(['diff', '--name-only', '-z', '--', ...staged])
  process.exitCode = await run(['--fix', ...staged], {
    cwd: process.cwd(),
    env: process.env,
    stdin: () => readStdin(process.stdin),
    writeOut: text => process.stdout.write(text),
    writeErr: text => process.stderr.write(text),
  })
  // Põe em stage só o que a correção mudou; alterações que já estavam fora do stage ficam fora.
  const unstagedBefore = new Set(before.split('\0').filter(Boolean))
  const fixed = git(['diff', '--name-only', '-z', '--', ...staged])
    .split('\0')
    .filter(file => file && !unstagedBefore.has(file))
  if (fixed.length > 0) git(['add', '--', ...fixed])
}
