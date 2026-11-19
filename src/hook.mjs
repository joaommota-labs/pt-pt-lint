// Claude Code hooks: PreToolUse blocks text that is not pt-PT before it is written or sent; Stop
// asks for a correction when the last reply has it.
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {loadConfig, matchesGlob} from './config.mjs'
import {lintText} from './lint.mjs'

const MAX_LISTED = 20
const CONFIRM_WINDOW_MS = 15 * 60_000
const SKIP_KEY =
  /^(id|ids|.*[_-]id|.*Id|.*_ids|url|uri|href|link|path|paths|file_?path|notebook_path|old_string|find_?text|old_?text|search_?text|pattern|glob|query|pql|jql|cql|regex|selector|ref|key|token|sha|branch|cwd|command|script|code|widget_code|tab_?id|model|subagent_type|type|action|scope|icon|colou?r|format|language|mime_?type|content_?type|status|state|priority|labels?|to|cc|bcc|from|email|date|timezone|start|end)$/i
const MESSAGE_COMMAND =
  /\bgit\s+(commit|tag)\b|\bgh\s+(pr|issue|release)\s+(create|edit|comment|review)\b/

function collectStrings(value, out) {
  if (typeof value === 'string') {
    if (value.length >= 3 && /\s/.test(value)) out.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      if (!SKIP_KEY.test(key)) collectStrings(item, out)
  }
}

/**
 * The text a tool call would write or send, with the file path when there is one.
 * @param {string} toolName
 * @param {Record<string, any>} input
 * @returns {{text: string, path?: string}[]}
 */
export function textsForTool(toolName, input) {
  switch (toolName) {
    case 'Write':
      return [{text: input.content, path: input.file_path}]
    case 'Edit':
      return [{text: input.new_string, path: input.file_path}]
    case 'MultiEdit':
      return (input.edits ?? []).map(edit => ({text: edit.new_string, path: input.file_path}))
    case 'NotebookEdit':
      return [
        {text: input.new_source, path: input.cell_type === 'markdown' ? undefined : 'cell.py'},
      ]
    case 'Bash':
      return MESSAGE_COMMAND.test(input.command ?? '')
        ? [{text: input.command, path: undefined}]
        : []
    default: {
      const strings = []
      collectStrings(input, strings)
      return strings.length > 0 ? [{text: strings.join('\n\n'), path: undefined}] : []
    }
  }
}

function safeConfig(dir) {
  try {
    return loadConfig(dir)
  } catch {
    return {allow: [], disable: [], ignore: [], root: dir}
  }
}

function describe(findings, withLine) {
  const lines = findings
    .slice(0, MAX_LISTED)
    .map(f => `- ${withLine ? `linha ${f.line}: ` : ''}«${f.match}» → «${f.suggestion}»`)
  if (findings.length > MAX_LISTED) lines.push(`… e mais ${findings.length - MAX_LISTED}`)
  return lines.join('\n')
}

function preToolUse(input, options) {
  const cwd = input.cwd ?? process.cwd()
  const findings = []
  const texts = textsForTool(input.tool_name, input.tool_input ?? {})
  for (const {text, path: file} of texts) {
    if (typeof text !== 'string') continue
    const absolute = file ? path.resolve(cwd, file) : undefined
    const config = safeConfig(absolute ? path.dirname(absolute) : cwd)
    if (absolute) {
      const relative = path.relative(config.root, absolute).replace(/\\/g, '/')
      if (config.ignore.some(glob => matchesGlob(relative, glob))) continue
      // An edit sends only a fragment: honour the marker of the file it lands in.
      if (
        existsSync(absolute) &&
        readFileSync(absolute, 'utf8').includes('pt-pt-lint-disable-file')
      )
        continue
    }
    findings.push(...lintText(text, {path: file, config}))
  }
  if (findings.length === 0) return null

  // Sending the same text again within 15 minutes confirms an intentional form; other fields of
  // the call (a description, a timeout) may change.
  const stateDir = options.stateDir ?? path.join(os.tmpdir(), 'pt-pt-lint-hook')
  const now = options.now ?? Date.now()
  const key = createHash('sha256')
    .update(`${input.tool_name}\n${JSON.stringify(texts)}`)
    .digest('hex')
  const marker = path.join(stateDir, key)
  if (existsSync(marker)) {
    const blockedAt = Number(readFileSync(marker, 'utf8'))
    rmSync(marker, {force: true})
    if (now - blockedAt < CONFIRM_WINDOW_MS) return null
  }
  mkdirSync(stateDir, {recursive: true})
  writeFileSync(marker, String(now))
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        'pt-pt-lint: o texto tem formas que não são português europeu (AO90):',
        describe(findings, true),
        'Corrige e repete. Se alguma ocorrência for intencional (p. ex. «fato» de vestuário), repete exatamente a mesma chamada para confirmar.',
      ].join('\n'),
    },
  }
}

function isGenuineUserEntry(entry) {
  if (entry.type !== 'user') return false
  const content = entry.message?.content
  return (
    typeof content === 'string' ||
    (Array.isArray(content) && content.some(block => block.type === 'text'))
  )
}

function stop(input) {
  if (input.stop_hook_active || !input.transcript_path) return null
  let raw
  try {
    raw = readFileSync(input.transcript_path, 'utf8')
  } catch {
    return null
  }
  const entries = raw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const lastUser = entries.findLastIndex(isGenuineUserEntry)
  const texts = entries
    .slice(lastUser + 1)
    .filter(entry => entry.type === 'assistant')
    .flatMap(entry =>
      entry.message.content.filter(block => block.type === 'text').map(block => block.text),
    )
  const findings = lintText(texts.join('\n\n'), {config: safeConfig(input.cwd ?? process.cwd())})
  if (findings.length === 0) return null
  return {
    decision: 'block',
    reason: [
      'pt-pt-lint: a tua última resposta tem formas que não são português europeu (AO90):',
      describe(findings, false),
      'Envia uma correção curta só com as frases corrigidas.',
    ].join('\n'),
  }
}

/**
 * @param {Record<string, any>} input the hook's JSON input
 * @param {{stateDir?: string, now?: number}} [options]
 * @returns {object | null} the JSON to print, or null to let the action through
 */
export function handleHook(input, options = {}) {
  if (input.hook_event_name === 'PreToolUse') return preToolUse(input, options)
  if (input.hook_event_name === 'Stop') return stop(input)
  return null
}
