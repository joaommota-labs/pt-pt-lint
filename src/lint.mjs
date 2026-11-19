// pt-pt-lint-disable-file: patterns name the Brazilian forms they catch.
import {localeOfPath, portugueseLines} from './language.mjs'
import {kindOf, maskText} from './regions.mjs'
import {
  BRAZILIAN,
  CIRCUMFLEX_EXCEPTIONS,
  CLOTHING,
  DETERMINERS,
  HOLIDAYS,
  MONTHS,
  NOT_GERUNDS,
  PRE_AO90,
} from './rules.mjs'

/**
 * @typedef {object} Finding
 * @property {string} rule br | ao90 | accent | fato | time | gerund | proclisis | month-case
 * @property {string} match the text found
 * @property {string} suggestion the pt-PT form
 * @property {boolean} fixable whether `--fix` replaces it
 * @property {number} index offset in the text
 * @property {number} line 1-based
 * @property {number} column 1-based
 */

/**
 * @typedef {object} LintOptions
 * @property {string} [path] file path: selects the file type and locale
 * @property {{allow?: string[], disable?: string[]}} [config]
 */

const L = '[\\p{L}\\p{N}_]'
const word = body => new RegExp(`(?<!${L})(?:${body})(?!${L})`, 'giu')
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalise = s => s.toLowerCase().replace(/\s+/g, ' ')

const DICTIONARY = new Map([
  ...BRAZILIAN.map(([form, to, fixable]) => [normalise(form), {rule: 'br', to, fixable}]),
  ...PRE_AO90.map(([form, to, fixable = true]) => [normalise(form), {rule: 'ao90', to, fixable}]),
])
const DICTIONARY_PATTERN = word(
  [...DICTIONARY.keys()]
    .sort((a, b) => b.length - a.length)
    .map(form => escapeRegExp(form).replace(/ /g, '\\s+'))
    .join('|'),
)

const AUXILIARIES = [
  'est(?:ou|ás|á|amos|ais|ão|ava|avas|ávamos|avam|ive|iveste|eve|ivemos|iveram|ivera|ar|ado|eja|ejas|ejamos|ejam|iver|ivermos|iverem|ivesse|ivessem|arei|arás|ará|aremos|arão|aria|ariam)',
  'and(?:o|as|a|amos|am|ava|avam|ei|ou|aram|ar|ado)',
  'continu(?:o|as|a|amos|am|ava|avam|ei|ou|aram|ar|e|em)',
  'fic(?:o|as|a|amos|am|ava|avam|ou|aram|ar|ado|ará|arei)',
].join('|')
const CLITICS = 'me|te|se|lhe|lhes|nos|vos|o|a|os|as'
const GERUND = new RegExp(
  `(?<!${L})(${AUXILIARIES})\\s+(?:(${CLITICS})\\s+)?(\\p{L}*?)(ando|endo|indo|ondo)(?!${L})`,
  'giud',
)
// The lookahead runs first so the lookbehind is only tried where a clitic starts; otherwise it
// rescans every run of whitespace from each position in it, which is quadratic.
const PROCLISIS = /(?=Me|Te|Lhe)(?<=^[ \t]*|[.!?…]\s+|[«"“(]\s*)(Me|Te|Lhe|Lhes)\s+(\p{Ll}+)/gmu
const TIME = new RegExp(
  `(?<!${L})(${Object.keys(DETERMINERS).join('|')})\\s+(times?)(?!${L}|-|\\s+(?:zones?|stamps?|lines?|frames?|sheets?|slots?|series|lapse|out|to|of|is|and|for|travel)(?!${L}))`,
  'giu',
)
const ACCENT = word('\\p{L}*[êô][mn][aeiouáéíóú]\\p{L}*')
const MONTH = new RegExp(`(?<!${L})(?:${MONTHS.join('|')})(?!${L})`, 'gu')
const FATO = word('fatos?')

const capitalise = s => s[0].toUpperCase() + s.slice(1)
const isCapitalised = s => s[0] !== s[0].toLowerCase()

function applyCase(source, replacement) {
  if (source.length > 1 && source === source.toUpperCase() && source !== source.toLowerCase()) {
    return replacement.toUpperCase()
  }
  // «Sistema Operacional» → «Sistema Operativo»: title case word by word when the words line up.
  const sourceWords = source.split(/\s+/)
  const words = replacement.split(' ')
  if (
    sourceWords.length > 1 &&
    sourceWords.length === words.length &&
    sourceWords.every(isCapitalised)
  ) {
    return words.map(capitalise).join(' ')
  }
  if (source[0] !== source[0].toLowerCase())
    return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

function infinitive(stem, ending) {
  if (ending === 'ondo') return stem === 'p' ? 'pôr' : `${stem}or`
  return stem + {ando: 'ar', endo: 'er', indo: 'ir'}[ending]
}

/** Each rule returns raw findings {index, match, suggestion, fixable}; earlier rules win overlaps. */
const RULES = [
  {
    id: 'fato',
    find: text =>
      [...text.matchAll(FATO)].flatMap(m => {
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40)
        if (new RegExp(`^\\s+(de\\s+(${CLOTHING})|e\\s+gravata)(?!${L})`, 'iu').test(after))
          return []
        const before = text.slice(Math.max(0, m.index - 12), m.index)
        const singular = m[0].length === 4
        const fixable =
          singular &&
          (/(^|[^\p{L}])de\s+$/iu.test(before) ||
            (/(^|[^\p{L}])(o|pelo|do|ao|no|num|dum)\s+$/iu.test(before) &&
              /^\s+de(?![\p{L}])/iu.test(after)) ||
            /^\s+é\s+que(?![\p{L}])/iu.test(after))
        const to = singular ? 'facto' : 'factos'
        return [{index: m.index, match: m[0], suggestion: applyCase(m[0], to), fixable}]
      }),
  },
  {
    id: 'time',
    find: text =>
      [...text.matchAll(TIME)].map(m => {
        const feminine = DETERMINERS[m[1].toLowerCase()]
        const noun = m[2].length > 4 ? 'equipas' : 'equipa'
        return {
          index: m.index,
          match: m[0],
          suggestion: `${applyCase(m[1], feminine)} ${noun}`,
          fixable: false,
        }
      }),
  },
  {
    id: 'gerund',
    find: text =>
      [...text.matchAll(GERUND)].flatMap(m => {
        const [, auxiliary, clitic, stem, ending] = m
        if (NOT_GERUNDS.has((stem + ending).toLowerCase())) return []
        const verb = infinitive(stem.toLowerCase(), ending)
        const suggestion = clitic
          ? `${auxiliary} a ${verb}-${clitic.toLowerCase()}`
          : `${auxiliary} a ${verb}`
        return [{index: m.index, match: m[0], suggestion, fixable: !clitic}]
      }),
  },
  {
    id: 'proclisis',
    find: text =>
      [...text.matchAll(PROCLISIS)].map(m => ({
        index: m.index,
        match: m[0],
        suggestion: `${applyCase('X', m[2])}-${m[1].toLowerCase()}`,
        fixable: false,
      })),
  },
  {
    id: 'dictionary',
    find: text =>
      [...text.matchAll(DICTIONARY_PATTERN)].map(m => {
        const entry = DICTIONARY.get(normalise(m[0]))
        return {
          rule: entry.rule,
          index: m.index,
          match: m[0],
          suggestion: applyCase(m[0], entry.to),
          fixable: entry.fixable,
        }
      }),
  },
  {
    id: 'accent',
    find: text =>
      [...text.matchAll(ACCENT)].flatMap(m => {
        // «têmURI»: a capital after the first letter means two words glued together, not one.
        if (CIRCUMFLEX_EXCEPTIONS.has(m[0].toLowerCase()) || /\p{Lu}/u.test(m[0].slice(1)))
          return []
        const suggestion = m[0].replace(
          /[êô](?=[mn][aeiouáéíóú])/giu,
          ch => ({ê: 'é', ô: 'ó', Ê: 'É', Ô: 'Ó'})[ch],
        )
        return [{index: m.index, match: m[0], suggestion, fixable: true}]
      }),
  },
  {
    id: 'month-case',
    find: text =>
      [...text.matchAll(MONTH)].flatMap(m => {
        const before = text.slice(Math.max(0, m.index - 200), m.index)
        if (/(^|[.!?:\n])\s*$/.test(before)) return []
        const day = /(\S+)\s+de\s+$/.exec(before)?.[1]
        if (day && HOLIDAYS[m[0]]?.includes(day)) return []
        return [{index: m.index, match: m[0], suggestion: m[0].toLowerCase(), fixable: false}]
      }),
  },
]

/** A match glued to a path, URL, property, variable or placeholder is not prose. */
function isCodeLike(text, start, end) {
  const before = text[start - 1] ?? ''
  const after = text[end] ?? ''
  if ('/\\._@#$=&?:'.includes(before) && before !== '') return true
  if ('/\\_@(='.includes(after) && after !== '') return true
  return after === '.' && /\w/.test(text[end + 1] ?? '')
}

/**
 * @param {string} text
 * @param {LintOptions} [options]
 * @returns {Finding[]}
 */
export function lintText(text, options = {}) {
  if (text.includes('pt-pt-lint-disable-file')) return []
  const locale = options.path ? localeOfPath(options.path) : null
  if (locale === 'other') return []
  const kind = kindOf(options.path, text)
  if (!kind) return []
  const masked = maskText(text, kind, locale !== 'pt')
  const portuguese = locale === 'pt' ? null : portugueseLines(masked)
  const lines = text.split('\n')
  const lineStarts = [0]
  for (const line of lines) lineStarts.push(lineStarts.at(-1) + line.length + 1)
  const disabled = new Set(options.config?.disable ?? [])
  const allowed = new Set((options.config?.allow ?? []).map(normalise))

  const taken = []
  const findings = []
  for (const rule of RULES) {
    for (const raw of rule.find(masked)) {
      const ruleId = raw.rule ?? rule.id
      const end = raw.index + raw.match.length
      if (disabled.has(ruleId) || allowed.has(normalise(raw.match))) continue
      if (isCodeLike(text, raw.index, end)) continue
      if (taken.some(([s, e]) => raw.index < e && end > s)) continue
      let line = 0
      while (lineStarts[line + 1] <= raw.index) line++
      if (portuguese && !portuguese[line]) continue
      if (lines[line].includes('pt-pt-lint-disable-line')) continue
      taken.push([raw.index, end])
      findings.push({
        rule: ruleId,
        match: text.slice(raw.index, end),
        suggestion: raw.suggestion,
        fixable: raw.fixable,
        index: raw.index,
        line: line + 1,
        column: raw.index - lineStarts[line] + 1,
      })
    }
  }
  return findings.sort((a, b) => a.index - b.index)
}

/**
 * Applies every fixable finding.
 * @param {string} text
 * @param {LintOptions} [options]
 * @returns {{text: string, fixed: number}}
 */
export function fixText(text, options = {}) {
  const fixable = lintText(text, options).filter(f => f.fixable)
  let result = text
  for (const finding of [...fixable].reverse()) {
    result =
      result.slice(0, finding.index) +
      finding.suggestion +
      result.slice(finding.index + finding.match.length)
  }
  return {text: result, fixed: fixable.length}
}
