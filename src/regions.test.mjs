import {describe, expect, it} from 'vitest'
import {kindOf, maskText} from './regions.mjs'

// Kept text with the masked parts collapsed, to read the result at a glance.
const kept = (text, kind, identifierMask = true) =>
  maskText(text, kind, identifierMask).replace(/\s+/g, ' ').trim()

describe('kindOf', () => {
  it.each([
    [undefined, '', 'prose'],
    ['a/README.md', '', 'prose'],
    ['Makefile', '', null],
    ['a.css', '', null],
    ['view.blade.php', '', 'php'],
    ['app.ts', 'const a = 1', 'js'],
    ['mscore_pt.ts', '<?xml version="1.0"?><TS>', 'xml'],
    ['Main.kt', '', 'c'],
    ['a.vue', '', 'html'],
    ['C:\\x\\pt.yml', '', 'yaml'],
  ])('%s', (file, text, kind) => expect(kindOf(file, text)).toBe(kind))
})

describe('code', () => {
  it('keeps comments, strings and escapes text', () => {
    expect(kept('a // fim', 'js')).toBe('fim')
    expect(kept('a /* sem fim', 'js')).toBe('sem fim')
    expect(kept('x = "um\\ndois" + \'três', 'js')).toBe('um dois três')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TypeScript source
    expect(kept('x = `Olá ${nome} e {conta}`', 'js')).toBe('Olá e')
    expect(kept('s := `texto cru`', 'c')).toBe('texto cru')
    expect(kept("x = 'chave'", 'js', false)).toBe('chave')
    expect(kept('x = """sem fim', 'hash')).toBe('sem fim')
    expect(kept('a ? b : c', 'js')).toBe('')
    expect(kept("x = 'Olá mundo\ny = 2", 'js')).toBe('Olá mundo')
    expect(kept('a <', 'js')).toBe('')
  })

  it('masks keys, identifiers and PHP attributes', () => {
    expect(kept("{'a b': 1, 'c d' => 2, x::y}", 'js')).toBe('')
    expect(kept("f('id-x', 'a.b', 'a/b', 'Texto livre')", 'js')).toBe('Texto livre')
    expect(kept("<?php #[Attr('x y')] # nota", 'php')).toBe('x y nota')
  })

  it('reads JSX text, nested tags, expressions and text attributes', () => {
    const jsx =
      'return (\n  <div title="Título" className="a b">Olá {nome} <b>mundo</b><br/>{"Fim aqui"}</div>\n)\nconst x = registo(1)'
    expect(kept(jsx, 'js')).toBe('Título Olá mundo Fim aqui')
    expect(kept("x = cond && <p title={'c d'} a={{b: 'e f'}}>texto</p>", 'js')).toBe('c d texto')
    expect(kept('default <>fragmento</>', 'js')).toBe('fragmento')
    expect(kept('const a: Array<string> = b < c', 'js')).toBe('')
    expect(kept('x = y\n<p>linha</p>', 'js')).toBe('linha')
    expect(kept('<p =x>sem nome</p>', 'js')).toBe('sem nome')
    expect(kept('<p>{a', 'js')).toBe('')
    expect(kept('<p>sem fecho', 'js')).toBe('sem fecho')
    expect(kept('<p>a < b</p>', 'js')).toBe('a < b')
  })
})

describe('markup', () => {
  it('reads text, comments and scripts and skips styles and interpolation', () => {
    const html =
      '<!-- nota --><p title="Título" :label="x y" data-a="b c">Olá {{ nome }} e {svelte}</p><style>p{}</style><script>// guião</script><!-- aberto'
    expect(kept(html, 'html')).toBe('nota Título Olá e guião aberto')
    expect(kept('<p>{{ sem fim', 'html')).toBe('')
    expect(kept('<script>sem fim', 'html')).toBe('')
    expect(kept("<p>Olá</p>@if ($a == 'x' && f('Texto livre')", 'html')).toBe('Olá Texto livre')
    expect(kept("<p>Olá</p>\n  @if ($a == 'X Y')\n  Sim @ casa", 'html')).toBe('Olá Sim @ casa')
    expect(kept('---\nconst a = "Título" // x\n---\n<h1>Olá</h1>', 'html')).toBe('Título x Olá')
  })

  it('splits PHP into HTML and code', () => {
    expect(kept('<p>Só HTML</p>', 'php')).toBe('Só HTML')
    expect(kept('<p>Olá</p><?= "Nome" ?><p>Fim</p><? // curto', 'php')).toBe('Olá Nome Fim curto')
  })

  it('keeps translatable XML text only', () => {
    expect(kept('<source>a</source><target state="x">Olá</target><value>Sim</value>', 'xml')).toBe(
      'Olá Sim',
    )
  })
})

describe('line formats', () => {
  it('reads YAML values, list items and comments', () => {
    expect(kept('chave: valor\n"a b": c\n- item\n# nota\ntexto solto', 'yaml')).toBe(
      'valor c item nota texto solto',
    )
  })

  it('reads properties values and comments', () => {
    expect(kept('a.b = Olá\n# nota\n! outra\nsem separador', 'props')).toBe('Olá nota outra')
  })

  it('reads gettext msgstr only', () => {
    const po =
      '#: src/a.c\nmsgctxt "x"\nmsgid "um"\nmsgid_plural "uns"\nmsgstr[0] "Um"\nmsgstr[1] "Uns"\n"mais"\n\nmsgid "b"\n"c"'
    expect(kept(po, 'po')).toBe('Um" Uns" mais"')
  })
})

describe('prose', () => {
  it('masks code, links, quotes and arrows', () => {
    const md =
      'Texto [ligação](https://a.pt) <Comp x="y" /> a@b.pt www.x.pt «citação» velho -> novo\n~~~\nbloco\n~~~\nfim'
    expect(kept(md, 'prose')).toBe('Texto [ligação -> novo fim')
  })
})
