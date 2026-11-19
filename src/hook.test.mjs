// pt-pt-lint-disable-file: fixtures quote Brazilian forms on purpose.
import {rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {handleHook, textsForTool} from './hook.mjs'
import {tempTree} from './test-helpers.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})
const dir = (files = {}) => {
  const root = tempTree(files)
  roots.push(root)
  return root
}

const BAD = 'O usuário não abriu a tela.'

describe('textsForTool', () => {
  it('reads file contents and edits with their path', () => {
    expect(textsForTool('Write', {file_path: 'a.md', content: BAD})).toEqual([
      {text: BAD, path: 'a.md'},
    ])
    expect(textsForTool('Edit', {file_path: 'a.ts', old_string: 'x', new_string: BAD})).toEqual([
      {text: BAD, path: 'a.ts'},
    ])
    expect(
      textsForTool('MultiEdit', {file_path: 'a.md', edits: [{new_string: 'a'}, {new_string: 'b'}]}),
    ).toEqual([
      {text: 'a', path: 'a.md'},
      {text: 'b', path: 'a.md'},
    ])
    expect(
      textsForTool('NotebookEdit', {
        notebook_path: 'n.ipynb',
        cell_type: 'markdown',
        new_source: BAD,
      }),
    ).toEqual([{text: BAD, path: undefined}])
    expect(textsForTool('NotebookEdit', {notebook_path: 'n.ipynb', new_source: 'x'})).toEqual([
      {text: 'x', path: 'cell.py'},
    ])
  })

  it('tolerates missing fields', () => {
    expect(textsForTool('MultiEdit', {file_path: 'a.md'})).toEqual([])
    expect(textsForTool('Bash', {})).toEqual([])
    expect(
      handleHook(
        {hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {file_path: 'a.md'}},
        {},
      ),
    ).toBeNull()
    expect(handleHook({hook_event_name: 'PreToolUse', tool_name: 'mcp__x__y'}, {})).toBeNull()
  })

  it('reads commit and pull request messages from shell commands only', () => {
    expect(textsForTool('Bash', {command: `git commit -m "${BAD}"`})).toHaveLength(1)
    expect(textsForTool('Bash', {command: `gh pr create --title x --body "${BAD}"`})).toHaveLength(
      1,
    )
    expect(textsForTool('Bash', {command: 'cat usuário.md'})).toEqual([])
  })

  it('collects prose from any other tool and skips technical fields', () => {
    const input = {
      to: ['a@b.pt'],
      subject: 'Olá equipa',
      body: BAD,
      thread_id: 'x y z',
      nested: [{description: 'Não há registro.'}, 3, null, 'ok'],
    }
    expect(textsForTool('mcp__gmail__create_draft', input)).toEqual([
      {text: `Olá equipa\n\n${BAD}\n\nNão há registro.`, path: undefined},
    ])
    expect(textsForTool('mcp__x__y', {id: 'a'})).toEqual([])
    expect(
      textsForTool('mcp__outline__update_document', {
        findText: BAD,
        text: 'O utilizador não abriu.',
      }),
    ).toEqual([{text: 'O utilizador não abriu.', path: undefined}])
  })
})

describe('handleHook PreToolUse', () => {
  const event = (tool_name, tool_input, extra = {}) => ({
    hook_event_name: 'PreToolUse',
    tool_name,
    tool_input,
    ...extra,
  })

  it('denies Brazilian Portuguese and lets clean text through', () => {
    const stateDir = dir()
    const denied = handleHook(event('Write', {file_path: 'a.md', content: BAD}), {stateDir})
    expect(denied.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain(
      'linha 1: «usuário» → «utilizador»',
    )
    expect(
      handleHook(event('Write', {file_path: 'a.md', content: 'O utilizador não abriu.'}), {
        stateDir,
      }),
    ).toBeNull()
  })

  it('lets the same text through on a confirmed retry', () => {
    const stateDir = dir()
    const input = event('mcp__x__send', {body: BAD})
    expect(handleHook(input, {stateDir, now: 1000})).not.toBeNull()
    expect(handleHook(input, {stateDir, now: 2000})).toBeNull()
    expect(handleHook(input, {stateDir, now: 3000})).not.toBeNull()
  })

  it('confirms on the same text even when other fields change', () => {
    const stateDir = dir()
    expect(
      handleHook(event('Bash', {command: `git commit -m "${BAD}"`, description: 'a'}), {stateDir}),
    ).not.toBeNull()
    expect(
      handleHook(event('Bash', {command: `git commit -m "${BAD}"`, description: 'b'}), {stateDir}),
    ).toBeNull()
  })

  it('expires a stale confirmation', () => {
    const stateDir = dir()
    const input = event('mcp__x__send', {body: BAD})
    handleHook(input, {stateDir, now: 0})
    expect(handleHook(input, {stateDir, now: 16 * 60_000})).not.toBeNull()
  })

  it('honours the config next to the file', () => {
    const root = dir({'.pt-pt-lint.json': JSON.stringify({ignore: ['legacy/**'], allow: ['tela']})})
    const stateDir = dir()
    expect(
      handleHook(event('Write', {file_path: path.join(root, 'legacy', 'a.md'), content: BAD}), {
        stateDir,
      }),
    ).toBeNull()
    const output = handleHook(event('Write', {file_path: path.join(root, 'a.md'), content: BAD}), {
      stateDir,
    })
    expect(output.hookSpecificOutput.permissionDecisionReason).not.toContain('tela')
    expect(
      handleHook(event('mcp__x__send', {body: BAD}, {cwd: root}), {stateDir}).hookSpecificOutput
        .permissionDecisionReason,
    ).not.toContain('tela')
  })

  it('falls back to defaults with an invalid config', () => {
    const root = dir({'.pt-pt-lint.json': '{'})
    expect(
      handleHook(event('mcp__x__send', {body: BAD}, {cwd: root}), {stateDir: dir()}),
    ).not.toBeNull()
  })

  it('honours a disable marker in the file being edited', () => {
    const root = dir({'quoted.md': 'pt-pt-lint-disable-file\nTexto antigo.'})
    const input = event('Edit', {
      file_path: path.join(root, 'quoted.md'),
      old_string: 'Texto antigo.',
      new_string: BAD,
    })
    expect(handleHook(input, {stateDir: dir()})).toBeNull()
  })

  it('lists at most twenty problems', () => {
    const text = Array.from({length: 25}, () => 'O usuário não existe.').join('\n')
    const reason = handleHook(event('mcp__x__send', {body: text}), {stateDir: dir()})
      .hookSpecificOutput.permissionDecisionReason
    expect(reason).toContain('… e mais 5')
  })
})

describe('handleHook Stop', () => {
  const transcript = (entries, root) => {
    const file = path.join(root, 't.jsonl')
    writeFileSync(file, `${entries.map(e => JSON.stringify(e)).join('\n')}\n`)
    return file
  }
  const user = content => ({type: 'user', message: {role: 'user', content}})
  const assistant = (...texts) => ({
    type: 'assistant',
    message: {role: 'assistant', content: texts.map(text => ({type: 'text', text}))},
  })
  const toolUse = {
    type: 'assistant',
    message: {role: 'assistant', content: [{type: 'tool_use', name: 'Read'}]},
  }
  const toolResult = user([{type: 'tool_result', content: 'O usuário antigo.'}])

  it('blocks the stop when the last reply has Brazilian Portuguese', () => {
    const root = dir()
    const file = transcript(
      [
        user('Olá'),
        assistant('O usuário antigo.'),
        user([{type: 'text', text: 'Mais'}]),
        toolUse,
        toolResult,
        assistant('Não há', BAD),
        {type: 'summary'},
      ],
      root,
    )
    const output = handleHook({hook_event_name: 'Stop', transcript_path: file}, {})
    expect(output.decision).toBe('block')
    expect(output.reason).toContain('«usuário» → «utilizador»')
    expect(output.reason).not.toContain('antigo')
  })

  it('stops normally when the reply is clean, already corrected or unreadable', () => {
    const root = dir()
    const clean = transcript([user('Olá'), assistant('O utilizador não abriu.')], root)
    expect(handleHook({hook_event_name: 'Stop', transcript_path: clean, cwd: root}, {})).toBeNull()
    const bad = transcript([user('Olá'), assistant(BAD)], root)
    expect(
      handleHook({hook_event_name: 'Stop', transcript_path: bad, stop_hook_active: true}, {}),
    ).toBeNull()
    expect(
      handleHook({hook_event_name: 'Stop', transcript_path: path.join(root, 'missing.jsonl')}, {}),
    ).toBeNull()
    expect(handleHook({hook_event_name: 'Stop'}, {})).toBeNull()
  })

  it('ignores other events', () => {
    expect(handleHook({hook_event_name: 'Notification'}, {})).toBeNull()
  })
})
