// Masks everything that is not human-readable text. The mask keeps the length and the line breaks
// of the input, so positions found in the mask are positions in the original text.

const EXT = {
  prose: 'md mdx markdown txt text rst adoc',
  json: 'json jsonc json5 arb',
  yaml: 'yml yaml',
  props: 'properties ini strings',
  po: 'po',
  xml: 'xlf xliff resx xml',
  html: 'html htm vue svelte astro hbs handlebars twig ejs erb njk liquid',
  hash: 'py rb sh bash zsh ps1 r pl toml',
  js: 'js jsx ts tsx mjs cjs mts cts',
  c: 'go java kt kts swift cs dart rs c h cpp hpp cc m mm scala groovy gradle',
}
const KIND_BY_EXT = new Map(
  Object.entries(EXT).flatMap(([kind, list]) => list.split(' ').map(ext => [ext, kind])),
)

/** Every extension the linter reads. */
export const SUPPORTED_EXTENSIONS = new Set([...KIND_BY_EXT.keys(), 'php'])

/**
 * @param {string | undefined} filePath
 * @param {string} text
 * @returns {string | null} null for a file type without text to check
 */
export function kindOf(filePath, text) {
  if (!filePath) return 'prose'
  const name = filePath.replace(/\\/g, '/').split('/').pop().toLowerCase()
  const ext = name.slice(name.lastIndexOf('.') + 1)
  if (ext === 'php') return 'php'
  if (ext === 'ts' && /^\s*(<\?xml|<!DOCTYPE TS|<TS[\s>])/.test(text)) return 'xml'
  return KIND_BY_EXT.get(ext) ?? null
}

// The bodies exclude the opening bracket too, so a long run of «{» or «(» is scanned once rather
// than once per bracket.
const PLACEHOLDER =
  /\$\{[^{}]*\}|#\{[^{}]*\}|\\\([^()]*\)|\{\{[^{}]*\}\}|\{[\w.]+\}|%(?:\d+\$)?[sdif@]|\\u[0-9a-fA-F]{4}|\\[nrtbfv0'"\\`]/g
const TEXT_ATTRIBUTES = new Set([
  'title',
  'alt',
  'placeholder',
  'aria-label',
  'aria-description',
  'label',
  'content',
  'summary',
])
const XML_TEXT = /<(target|value|translation|string|item|numerusform)\b[^>]*>([\s\S]*?)<\/\1>/gi

class Mask {
  /** @param {string} text */
  constructor(text) {
    this.text = text
    this.chars = text.replace(/[^\n]/g, ' ').split('')
  }

  keep(start, end) {
    for (let i = start; i < end; i++) this.chars[i] = this.text[i]
    for (const m of this.text.slice(start, end).matchAll(PLACEHOLDER))
      this.blank(start + m.index, start + m.index + m[0].length)
  }

  blank(start, end) {
    for (let i = start; i < end; i++) if (this.chars[i] !== '\n') this.chars[i] = ' '
  }

  toString() {
    return this.chars.join('')
  }
}

/**
 * @param {string} text
 * @param {string} kind from {@link kindOf}
 * @param {boolean} identifierMask mask single-word lowercase strings in code
 */
export function maskText(text, kind, identifierMask) {
  const mask = new Mask(text)
  const end = text.length
  if (kind === 'prose') maskProse(mask)
  else if (kind === 'json') scanCode(mask, 0, end, {slash: true, identifierMask: false})
  else if (kind === 'js')
    scanCode(mask, 0, end, {slash: true, backtick: true, jsx: true, identifierMask})
  else if (kind === 'c') scanCode(mask, 0, end, {slash: true, backtick: true, identifierMask})
  else if (kind === 'hash') scanCode(mask, 0, end, {hash: true, triple: true, identifierMask})
  else if (kind === 'php') scanPhp(mask, identifierMask)
  else if (kind === 'html') scanHtml(mask, 0, end, identifierMask)
  else if (kind === 'xml') for (const m of text.matchAll(XML_TEXT)) keepGroup(mask, m, 2)
  else scanLines(mask, kind)
  return mask.toString()
}

function keepGroup(mask, match, group) {
  const start = match.index + match[0].indexOf(match[group], match[0].indexOf('>') + 1)
  mask.keep(start, start + match[group].length)
}

function maskProse(mask) {
  const {text} = mask
  mask.keep(0, text.length)
  const blanks = [
    /^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm,
    /`[^`\n]+`/g,
    // An address only starts where a run of address characters starts, so a long run without
    // «@» is scanned once.
    /\bhttps?:\/\/\S+|\bwww\.\S+|(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.]+/g,
    /«[^«»\n]*»/g,
    /\]\([^)\n]*\)/g,
    /<\/?[A-Za-z][^>\n]*>/g,
  ]
  for (const pattern of blanks)
    for (const m of text.matchAll(pattern)) mask.blank(m.index, m.index + m[0].length)
  // «usuário → utilizador»: the form before an arrow is quoted, not used.
  for (const m of text.matchAll(/(^|[,;:|([«"“—–])([^,;:|([«"“—–\n]*?)(→|->)/gm)) {
    const start = m.index + m[1].length
    mask.blank(start, start + m[2].length)
  }
}

/** Index of `needle` from `from`, or `end` when it is missing or past `end`. */
function until(text, needle, from, end) {
  const index = text.indexOf(needle, from)
  return index === -1 || index > end ? end : index
}

function isKey(text, position) {
  let p = position
  while (text[p] === ' ' || text[p] === '\t') p++
  return (text[p] === ':' && text[p + 1] !== ':') || text.startsWith('=>', p)
}

/** `x == 'Activa'`: a string compared with data is a value, not text to rewrite. */
function isCompared(text, start, after) {
  const before = text.slice(Math.max(0, start - 4), start).trimEnd()
  const next = text.slice(after, after + 4).trimStart()
  return /(==|!=|<>)$/.test(before) || /^(==|!=|<>)/.test(next)
}

function looksLikeIdentifier(raw) {
  const value = raw.replace(/\\[nrt]/g, ' ')
  return !/\s/.test(value) && (/[._/:@#\\{}<>=$%|]/.test(value) || /^[a-z0-9_-]*$/.test(value))
}

/**
 * Keeps comments and string literals (except object keys and identifier-like strings) and, with
 * `jsx`, the text between JSX tags.
 */
function scanCode(mask, start, end, options) {
  const {text} = mask
  let i = start
  while (i < end) {
    const c = text[i]
    const next = text[i + 1]
    const slashComment = options.slash && c === '/' && next === '/'
    const hashComment = options.hash && c === '#' && !(options.php && next === '[')
    if (slashComment || hashComment) {
      const stop = until(text, '\n', i, end)
      mask.keep(i + (hashComment ? 1 : 2), stop)
      i = stop
    } else if (options.slash && c === '/' && next === '*') {
      const stop = until(text, '*/', i + 2, end)
      mask.keep(i + 2, stop)
      i = stop + 2
    } else if (c === '"' || c === "'" || (c === '`' && options.backtick)) {
      i = scanString(mask, i, end, options)
    } else if (options.jsx && c === '<' && isTagStart(text, i)) {
      i = scanJsx(mask, i, end, options)
    } else {
      i++
    }
  }
}

function scanString(mask, start, end, options) {
  const {text} = mask
  const c = text[start]
  const quote = options.triple && text.startsWith(c.repeat(3), start) ? c.repeat(3) : c
  let j = start + quote.length
  while (j < end && !text.startsWith(quote, j)) {
    if (text[j] === '\\') j++
    else if (quote.length === 1 && c !== '`' && text[j] === '\n') break
    j++
  }
  const contentStart = start + quote.length
  const contentEnd = Math.min(j, end)
  const value = text.slice(contentStart, contentEnd)
  const after = j + (text.startsWith(quote, j) ? quote.length : 0)
  if (
    !isKey(text, after) &&
    !isCompared(text, start, after) &&
    !(options.identifierMask && looksLikeIdentifier(value))
  ) {
    mask.keep(contentStart, contentEnd)
  }
  return Math.max(after, start + 1)
}

function isTagStart(text, i) {
  if (!/[A-Za-z/>]/.test(text.charAt(i + 1))) return false
  let k = i - 1
  while (text[k] === ' ' || text[k] === '\t') k--
  if (k < 0 || !/[\w$)\]]/.test(text[k])) return true
  let w = k
  while (w >= 0 && /[\w$]/.test(text[w])) w--
  return ['return', 'yield', 'await', 'default'].includes(text.slice(w + 1, k + 1))
}

/** Scans one tag at `start`; returns the index after it and how it changes nesting. */
function scanTag(mask, start, end) {
  const {text} = mask
  let j = start + 1
  let depth = 0
  let attribute = ''
  while (j < end) {
    const ch = text[j]
    if (ch === '=') {
      // Read the name backwards from the «=»; a regex over the whole tag so far is quadratic
      // on a long run of «=».
      let nameEnd = j
      while (nameEnd > start && /\s/.test(text[nameEnd - 1])) nameEnd--
      let nameStart = nameEnd
      while (nameStart > start && /[\w:@.-]/.test(text[nameStart - 1])) nameStart--
      attribute = text.slice(nameStart, nameEnd).toLowerCase()
    } else if (ch === '"' || ch === "'") {
      const close = until(text, ch, j + 1, end)
      if (TEXT_ATTRIBUTES.has(attribute)) mask.keep(j + 1, close)
      j = close
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
    } else if (ch === '>' && depth <= 0) {
      break
    }
    j++
  }
  const body = text.slice(start + 1, j)
  const nesting = body.startsWith('/') ? -1 : body.endsWith('/') ? 0 : 1
  return {after: j + 1, nesting}
}

function scanJsx(mask, start, end, options) {
  const {text} = mask
  let i = start
  let open = 0
  while (i < end) {
    if (text[i] === '<' && /[A-Za-z/>]/.test(text.charAt(i + 1))) {
      const tag = scanTag(mask, i, end)
      open += tag.nesting
      i = tag.after
      if (open <= 0) return i
    } else if (text[i] === '{') {
      const close = matchingBrace(text, i, end)
      scanCode(mask, i + 1, close, options)
      i = close + 1
    } else {
      let stop = i + 1
      while (stop < end && text[stop] !== '<' && text[stop] !== '{') stop++
      mask.keep(i, stop)
      i = stop
    }
  }
  return i
}

function matchingParen(text, start, end) {
  let depth = 0
  for (let i = start; i < end; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return end
}

function matchingBrace(text, start, end) {
  let depth = 0
  for (let i = start; i < end; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return end
}

function scanHtml(mask, start, end, identifierMask) {
  const {text} = mask
  const code = {slash: true, backtick: true, identifierMask}
  let i = start
  if (text.startsWith('---', i)) {
    const stop = until(text, '\n---', i + 3, end)
    scanCode(mask, i + 3, stop, code)
    i = stop + 4
  }
  while (i < end) {
    if (text.startsWith('<!--', i)) {
      const close = until(text, '-->', i, end)
      mask.keep(i + 4, close)
      i = close + 3
    } else if (text[i] === '<' && /[A-Za-z/!?]/.test(text.charAt(i + 1))) {
      const name = /^<\/?([\w-]+)/.exec(text.slice(i))?.[1]?.toLowerCase()
      const {after} = scanTag(mask, i, end)
      const closing = text[i + 1] === '/'
      if (!closing && (name === 'script' || name === 'style')) {
        const close = until(text, `</${name}`, after, end)
        if (name === 'script') scanCode(mask, after, close, code)
        i = close
      } else {
        i = after
      }
    } else if (text[i] === '@' && /^@\w+\s*\(/.test(text.slice(i, i + 40))) {
      // Blade directive: @if (...), @foreach (...) hold PHP code.
      const open = text.indexOf('(', i)
      const close = matchingParen(text, open, end)
      scanCode(mask, open + 1, close, code)
      i = close + 1
    } else if (text.startsWith('{{', i)) {
      i = until(text, '}}', i, end) + 2
    } else if (text[i] === '{') {
      i = matchingBrace(text, i, end) + 1
    } else {
      let stop = i + 1
      while (stop < end && text[stop] !== '<' && text[stop] !== '{' && text[stop] !== '@') stop++
      mask.keep(i, stop)
      i = stop
    }
  }
}

function scanPhp(mask, identifierMask) {
  const {text} = mask
  const code = {slash: true, hash: true, php: true, identifierMask}
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('<?', i)
    const htmlEnd = open === -1 ? text.length : open
    scanHtml(mask, i, htmlEnd, identifierMask)
    if (open === -1) return
    const codeStart =
      open + (text.startsWith('<?php', open) ? 5 : text.startsWith('<?=', open) ? 3 : 2)
    const close = until(text, '?>', codeStart, text.length)
    scanCode(mask, codeStart, close, code)
    i = close + 2
  }
}

function scanLines(mask, kind) {
  const {text} = mask
  let offset = 0
  let poKeep = false
  for (const line of text.split('\n')) {
    const keepFrom = from => mask.keep(offset + from, offset + line.length)
    if (kind === 'yaml') {
      const key = /^([ \t]*(?:-[ \t]*)?)(?:"[^"]*"|'[^']*'|[^:#'"\s][^:#]*?):(\s|$)/.exec(line)
      if (key) keepFrom(key[0].length)
      else if (/^\s*(-\s|#)/.test(line)) keepFrom(line.search(/[-#]/) + 1)
      else keepFrom(0)
    } else if (kind === 'props') {
      const separator = line.search(/[=:]/)
      if (/^\s*[#!;]/.test(line)) keepFrom(line.search(/[#!;]/) + 1)
      else if (separator !== -1) keepFrom(separator + 1)
    } else {
      const keyword = /^\s*(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s/.exec(line)
      if (keyword) poKeep = keyword[1].startsWith('msgstr')
      const quote = line.indexOf('"')
      if (poKeep && quote !== -1 && !line.trimStart().startsWith('#')) keepFrom(quote + 1)
    }
    offset += line.length + 1
  }
}
