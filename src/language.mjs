// pt-pt-lint-disable-file: lists Spanish and English marker words.

const LOCALES =
  'pt|en|es|fr|de|it|nl|pl|ru|uk|ar|zh|ja|ko|tr|ca|gl|eu|sv|da|fi|nb|nn|no|cs|ro|hu|el|he|hi|id|th|vi|bg|hr|sk|sl|sr|lt|lv|et|fa|ms'
const LOCALE_SEGMENT = new RegExp(`^(${LOCALES})(?:[-_]([a-z]{2,4}))?$`, 'i')
const PT_SUFFIX = /[._-](pt)(?:[-_]([a-z]{2}))?$/i
const LOCALE_SUFFIX = new RegExp(`[._-](${LOCALES})(?:[-_]([a-z]{2,4}))?$`, 'i')
const LOCALE_DIR =
  /^(locales?|langs?|languages|i18n|l10n|messages|translations?|intl|locali[sz]ations?)$/i

/**
 * Locale a path declares, from a folder or file name such as `pt/`, `pt-PT.json`, `i18n/es.json`
 * or `app_pt_BR.ts`. Brazilian Portuguese counts as another locale: it is correct there. Other
 * languages count only inside a locale folder, so `src/de/` or `it.md` stay unknown.
 * @param {string} filePath
 * @returns {'pt' | 'other' | null}
 */
export function localeOfPath(filePath) {
  const segments = filePath.replace(/\\/g, '/').split('/')
  const stem = segments.pop().replace(/(\.[^.]+)+$/, '')
  const inLocaleDir = segments.some(s => LOCALE_DIR.test(s))
  const matches = [...segments, stem].map(s => LOCALE_SEGMENT.exec(s))
  // A suffix (`messages_ro.js`) decides only when no folder or file name did.
  matches.push(PT_SUFFIX.exec(stem))
  let locale = null
  for (const match of matches) {
    if (!match) continue
    const [, language, region] = match
    const portuguese = language.toLowerCase() === 'pt'
    if (portuguese && region?.toLowerCase() === 'br') return 'other'
    if (portuguese) locale = 'pt'
    else if (inLocaleDir) return 'other'
  }
  if (!locale && inLocaleDir && LOCALE_SUFFIX.test(stem)) return 'other'
  return locale
}

const PT_WORDS = new Set(
  'o os do da dos das no na nas num numa um uma umas com não é há à ao aos às também já isso isto ainda até você vocês nós ou pelo pela pelos pelas seu sua são está estão foi então muito muita olá obrigado em sem mais nem quando onde pode podem deve devem'.split(
    ' ',
  ),
)
const ES_WORDS = new Set(
  'el los las la del en y con una es pero muy también qué cómo usuario ellos sus hay está'.split(
    ' ',
  ),
)
// «no» counts for both languages: it is a Portuguese contraction and a frequent English word.
const EN_WORDS = new Set(
  'the is are and of to it this that with without for on be was not no you at by from an or all only any into after before which when where should must can will has have does'.split(
    ' ',
  ),
)

function scores(text) {
  const score = {pt: 0, es: 0, en: 0}
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (PT_WORDS.has(word) || /(ção|ções|ões|ão)$/.test(word)) score.pt++
    if (ES_WORDS.has(word) || /(ción|ciones)$/.test(word) || word.includes('ñ')) score.es++
    if (EN_WORDS.has(word)) score.en++
  }
  return score
}

const looksPortuguese = s => s.pt > s.es && s.pt > s.en

/**
 * Per line: is it Portuguese? A line without marker words (a short label) takes the verdict of
 * the two lines around it.
 * @param {string} text
 * @returns {boolean[]}
 */
export function portugueseLines(text) {
  const lineScores = text.split('\n').map(scores)
  return lineScores.map((own, index) => {
    if (own.pt + own.es + own.en > 0) return looksPortuguese(own)
    const around = {pt: 0, es: 0, en: 0}
    for (let i = Math.max(0, index - 2); i <= Math.min(lineScores.length - 1, index + 2); i++) {
      for (const key of ['pt', 'es', 'en']) around[key] += lineScores[i][key]
    }
    return looksPortuguese(around)
  })
}
