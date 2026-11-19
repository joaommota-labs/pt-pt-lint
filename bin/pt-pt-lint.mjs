#!/usr/bin/env node
import {readStdin, run} from '../src/cli.mjs'

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdin: () => readStdin(process.stdin),
  writeOut: text => process.stdout.write(text),
  writeErr: text => process.stderr.write(text),
})
