import {readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {loadConfig} from './config.mjs'
import {listFiles} from './files.mjs'
import {handleHook} from './hook.mjs'
import {fixText, lintText} from './lint.mjs'

const USAGE = `Uso: pt-pt-lint [opções] [ficheiros ou pastas...]

Verifica português europeu (pt-PT, AO90): vocabulário e gramática do Brasil e grafia anterior ao Acordo.
Sem caminhos, verifica os ficheiros do repositório Git (ou da pasta atual).

Opções:
  --fix                 Corrige as ocorrências inequívocas nos ficheiros
  --strict              Falha também com ocorrências para rever (por omissão só falha com corrigíveis)
  --format <formato>    text | github | json (github por omissão no GitHub Actions)
  --stdin               Lê o texto da entrada padrão
  --stdin-path <path>   Caminho que define o tipo de ficheiro do texto lido com --stdin
  --hook <evento>       pre-tool-use | stop: hook do Claude Code (JSON na entrada padrão)
  -h, --help            Mostra esta ajuda

Configuração: .pt-pt-lint.json com {"allow": [...], "disable": [...], "ignore": [...]}.
`

/**
 * @param {AsyncIterable<Buffer | string>} stream
 */
export async function readStdin(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function parse(argv) {
  const options = {fix: false, strict: false, stdin: false, paths: []}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fix') options.fix = true
    else if (arg === '--strict') options.strict = true
    else if (arg === '--stdin') options.stdin = true
    else if (arg === '--format') options.format = argv[++i]
    else if (arg === '--stdin-path') options.stdinPath = argv[++i]
    else if (arg === '--hook') options.hook = argv[++i]
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg.startsWith('-')) return {error: `Opção desconhecida: ${arg}`}
    else options.paths.push(arg)
  }
  return options
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function report(results, format, fixed, write) {
  if (format === 'json') {
    write(`${JSON.stringify(results, null, 2)}\n`)
    return
  }
  for (const r of results) {
    if (format === 'github') {
      const level = r.fixable ? 'error' : 'warning'
      const note = r.fixable ? ' (corrigível com --fix)' : ' (rever)'
      write(
        `::${level} file=${r.file},line=${r.line},col=${r.column},title=pt-PT (${r.rule})::«${r.match}» → «${r.suggestion}»${note}\n`,
      )
    } else {
      write(
        `${r.file}:${r.line}:${r.column}  «${r.match}» → «${r.suggestion}»  [${r.rule}, ${r.fixable ? 'corrigível' : 'rever'}]\n`,
      )
    }
  }
  if (fixed > 0)
    write(`pt-pt-lint: ${plural(fixed, 'correção aplicada', 'correções aplicadas')}.\n`)
  if (results.length === 0) {
    write('pt-pt-lint: Sem problemas.\n')
    return
  }
  const files = new Set(results.map(r => r.file)).size
  const fixable = results.filter(r => r.fixable).length
  write(
    `pt-pt-lint: ${plural(results.length, 'problema', 'problemas')} em ${plural(files, 'ficheiro', 'ficheiros')} (${plural(fixable, 'corrigível', 'corrigíveis')} com --fix).\n`,
  )
}

/**
 * @param {string[]} argv
 * @param {{cwd: string, env: Record<string, string | undefined>, stdin: () => Promise<string>, writeOut: (s: string) => void, writeErr: (s: string) => void}} io
 * @returns {Promise<number>} exit code: 0 ok, 1 problems, 2 usage or config error
 */
export async function run(argv, io) {
  const {cwd, env, stdin, writeOut, writeErr} = io

  const options = parse(argv)
  if (options.error) {
    writeErr(`${options.error}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    writeOut(USAGE)
    return 0
  }
  if (options.hook) {
    if (!['pre-tool-use', 'stop'].includes(options.hook)) {
      writeErr(`Hook desconhecido: ${options.hook}\n`)
      return 2
    }
    const output = handleHook(JSON.parse(await stdin()))
    if (output) writeOut(JSON.stringify(output))
    return 0
  }

  let config
  try {
    config = loadConfig(cwd)
  } catch (error) {
    writeErr(`${error.message}\n`)
    return 2
  }
  const format = options.format ?? (env.GITHUB_ACTIONS === 'true' ? 'github' : 'text')
  const results = []
  let fixed = 0
  if (options.stdin) {
    const file = options.stdinPath ?? '<stdin>'
    for (const f of lintText(await stdin(), {path: options.stdinPath, config}))
      results.push({file, ...f})
  } else {
    for (const file of listFiles(cwd, options.paths, config)) {
      const absolute = path.join(cwd, file)
      let text = readFileSync(absolute, 'utf8')
      if (options.fix) {
        const result = fixText(text, {path: file, config})
        if (result.fixed > 0) {
          writeFileSync(absolute, result.text)
          fixed += result.fixed
          text = result.text
        }
      }
      for (const f of lintText(text, {path: file, config})) results.push({file, ...f})
    }
  }
  report(results, format, fixed, writeOut)
  const failing = options.strict ? results.length : results.filter(r => r.fixable).length
  return failing > 0 ? 1 : 0
}
