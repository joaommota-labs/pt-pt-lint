#!/usr/bin/env node
// Script do Lefthook remoto (lefthook-remote.yml): corrige o português dos
// ficheiros em stage, volta a pô-los em stage e falha se ficar algo corrigível por corrigir.
// A lógica está em src/staged.mjs, que nunca passa a lista de ficheiros ao git como argumentos.
import {readStdin} from '../../src/cli.mjs'
import {fixStaged} from '../../src/staged.mjs'

process.exitCode = await fixStaged({
  cwd: process.cwd(),
  env: process.env,
  stdin: () => readStdin(process.stdin),
  writeOut: text => process.stdout.write(text),
  writeErr: text => process.stderr.write(text),
})
