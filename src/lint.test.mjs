// pt-pt-lint-disable-file: fixtures quote Brazilian and pre-AO90 forms on purpose.
import {describe, expect, it} from 'vitest'
import {localeOfPath} from './language.mjs'
import {fixText, lintText} from './lint.mjs'

const pairs = (text, options) => lintText(text, options).map(f => [f.match, f.suggestion])
const fix = (text, options) => fixText(text, options).text

describe('Brazilian vocabulary', () => {
  it('fixes unambiguous words and preserves case', () => {
    expect(fix('O usuário não está na equipe.')).toBe('O utilizador não está na equipa.')
    expect(fix('Usuários e contatos também.')).toBe('Utilizadores e contactos também.')
    expect(fix('O REGISTRO do usuário não existe.')).toBe('O REGISTO do utilizador não existe.')
  })

  it('flags ambiguous words without fixing them', () => {
    const findings = lintText('Não consigo abrir a senha na tela do celular.')
    expect(findings.map(f => [f.match, f.fixable])).toEqual([
      ['senha', false],
      ['tela', false],
      ['celular', false],
    ])
    expect(fix('Não consigo abrir o arquivo na tela.')).toBe('Não consigo abrir o arquivo na tela.')
  })

  it('only reviews replacements that change the gender', () => {
    expect(
      lintText('Os aplicativos nativos e o gerenciamento não mudam.').map(f => [
        f.match,
        f.fixable,
      ]),
    ).toEqual([
      ['aplicativos', false],
      ['gerenciamento', false],
    ])
  })

  it('knows common software terms', () => {
    expect(fix('O sistema operacional não arranca.')).toBe('O sistema operativo não arranca.')
    expect(
      lintText('Digite a palavra-passe e veja o banco de dados.').map(f => [
        f.match,
        f.suggestion,
        f.fixable,
      ]),
    ).toEqual([
      ['Digite', 'Introduza', false],
      ['banco de dados', 'base de dados', false],
    ])
  })

  it('keeps title case word by word', () => {
    expect(fix('Categoria: Sistema Operacional, não outro.')).toBe(
      'Categoria: Sistema Operativo, não outro.',
    )
  })

  it('fixes multi-word expressions', () => {
    expect(fix('Não há café da manhã para o usuário.')).toBe(
      'Não há pequeno-almoço para o utilizador.',
    )
  })
})

describe('false positives found in real repositories', () => {
  it('recognises short Portuguese comments', () => {
    expect(fix('// Step-up obrigatório quando MFA activo.', {path: 'a.ts'})).toBe(
      '// Step-up obrigatório quando MFA ativo.',
    )
    expect(fix('// ambiente de teste, sem 2FA activo no início', {path: 'a.ts'})).toBe(
      '// ambiente de teste, sem 2FA ativo no início',
    )
  })

  it('treats English lines with «no» as English', () => {
    expect(pairs('Records five actual HTTP calls with no mutation keys.')).toEqual([])
  })

  it('flags arquivo only in clearly Brazilian expressions', () => {
    expect(fix('O sistema de arquivos não abre o arquivo de configuração.')).toBe(
      'O sistema de ficheiros não abre o ficheiro de configuração.',
    )
    expect(pairs('Três álbuns, um arquivo aberto. Excluir Python não elimina nada.')).toEqual([])
  })

  it('reviews pre-AO90 words that are also English', () => {
    expect(lintText('O gestor actual não é o factor.').map(f => [f.match, f.fixable])).toEqual([
      ['actual', false],
      ['factor', false],
    ])
  })

  it('skips other locales in localization folders', () => {
    expect(localeOfPath('public/js/localization/messages_ro.js')).toBe('other')
    expect(localeOfPath('lang/pt/regras_id.php')).toBe('pt')
    expect(localeOfPath('src/utils/use-id.ts')).toBeNull()
  })
})

describe('fato and time', () => {
  it('fixes fato in the sense of facto', () => {
    expect(fix('De fato, o fato de não haver dados é um problema.')).toBe(
      'De facto, o facto de não haver dados é um problema.',
    )
  })

  it('keeps fato as clothing', () => {
    expect(pairs('Ele não trouxe o fato de banho nem o fato e gravata.')).toEqual([])
  })

  it('handles plurals of fato and time', () => {
    expect(pairs('Os fatos não mentem e os times não perdem.')).toEqual([
      ['fatos', 'factos'],
      ['os times', 'as equipas'],
    ])
  })

  it('flags any other fato for review', () => {
    expect(lintText('Comprou um fato que não serve.').map(f => [f.match, f.fixable])).toEqual([
      ['fato', false],
    ])
  })

  it('flags time only as a Portuguese noun', () => {
    expect(
      lintText('O nosso time não perdeu com o time deles.').map(f => [f.match, f.fixable]),
    ).toEqual([
      ['nosso time', false],
      ['o time', false],
    ])
    expect(
      pairs('A sincronização em real time não é para o time zone da Ásia? Também não.'),
    ).toEqual([])
    expect(pairs('It is time to ship the release.')).toEqual([])
  })
})

describe('AO90 and accents', () => {
  it('fixes pre-AO90 spellings', () => {
    expect(fix('A acção foi óptima e a direcção também, para já.')).toBe(
      'A ação foi ótima e a direção também, para já.',
    )
    expect(fix('Não há-de ser nada, actualmente.')).toBe('Não há de ser nada, atualmente.')
  })

  it('knows adoptar and afectar', () => {
    expect(fix('As medidas adoptadas estão a afectar e afectando a área afectada.')).toBe(
      'As medidas adotadas estão a afetar e afetando a área afetada.',
    )
  })

  it('keeps consonants that are pronounced in Portugal', () => {
    expect(pairs('O facto é que o contacto não é a secção certa.')).toEqual([])
  })

  it('fixes Brazilian circumflex before m or n', () => {
    expect(fix('O gênero e o fenômeno econômico não são do Antônio.')).toBe(
      'O género e o fenómeno económico não são do António.',
    )
    expect(pairs('A fêmea não tem sêmola, mas têm três cêntimos.')).toEqual([])
    expect(pairs('Os 15 não têmURI e mantêmInProgress.')).toEqual([])
  })

  it('accepts lowercase months and a capital month at the start of a sentence', () => {
    expect(pairs('O prazo termina em junho, não em julho.')).toEqual([])
    expect(pairs('Não houve nada. Outubro foi calmo.')).toEqual([])
  })

  it('flags capitalised months inside sentences except holidays', () => {
    expect(
      lintText('A reunião é em Outubro, não no 25 de Abril.').map(f => [f.match, f.suggestion]),
    ).toEqual([['Outubro', 'outubro']])
  })
})

describe('grammar', () => {
  it('replaces the gerund after estar, andar, continuar and ficar', () => {
    expect(fix('Estou fazendo testes e ele continua lendo, não está indo embora.')).toBe(
      'Estou a fazer testes e ele continua a ler, não está a ir embora.',
    )
    expect(fix('Ela está pondo a mesa e está compondo música também.')).toBe(
      'Ela está a pôr a mesa e está a compor música também.',
    )
  })

  it('flags the gerund with a clitic without fixing it', () => {
    expect(lintText('Estou te ligando porque não sei.').map(f => f.fixable)).toEqual([false])
  })

  it('ignores words that only look like gerunds', () => {
    expect(pairs('O dia está lindo e não sei quando.')).toEqual([])
    expect(pairs('Os valores são estáveis mantendo a média.')).toEqual([])
  })

  it('flags proclisis at the start of a sentence', () => {
    expect(
      lintText('Me diga se não correu bem. Se correr, ótimo.').map(f => [f.match, f.fixable]),
    ).toEqual([['Me diga', false]])
    expect(pairs('Nos últimos dias não houve erros.')).toEqual([])
  })
})

describe('language detection', () => {
  it('ignores English and Spanish text', () => {
    expect(pairs('The usuário field is shown on the tela.')).toEqual([])
    expect(pairs('El usuario abre el registro en el celular y la aplicación.')).toEqual([])
  })

  it('assumes Portuguese in pt locale files', () => {
    expect(pairs('"save": "Salvar"', {path: 'messages/pt.json'})).toEqual([['Salvar', 'Guardar']])
    expect(pairs('save = Salvar', {path: 'locales/pt-PT/app.properties'})).toEqual([
      ['Salvar', 'Guardar'],
    ])
  })

  it('skips Brazilian and other locales', () => {
    expect(pairs('"title": "O usuário não existe"', {path: 'locales/pt-BR.json'})).toEqual([])
    expect(pairs('"title": "O usuário não existe"', {path: 'src/i18n/es.json'})).toEqual([])
    expect(pairs('O usuário não existe.', {path: 'share/locale/mscore_pt_BR.ts'})).toEqual([])
    expect(pairs('O usuário não existe.', {path: 'src/de/notas.md'})).toEqual([
      ['usuário', 'utilizador'],
    ])
  })
})

describe('file kinds', () => {
  it('checks JSON values and never keys', () => {
    expect(fix('{"registro": "O registro do usuário não existe"}', {path: 'pt.json'})).toBe(
      '{"registro": "O registo do utilizador não existe"}',
    )
  })

  it('checks only strings and comments in code', () => {
    const code = [
      'const usuario = await registro(id) // não há usuário',
      "const label = 'O usuário não tem acesso'",
      "db.where('registro', 1)",
      "const route = '/usuário/registro'",
      '/* o contato',
      '   não existe */',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TypeScript source
      '`Olá ${usuário}, não há registro`',
    ].join('\n')
    expect(pairs(code, {path: 'src/app.ts'})).toEqual([
      ['usuário', 'utilizador'],
      ['usuário', 'utilizador'],
      ['contato', 'contacto'],
      ['registro', 'registo'],
    ])
  })

  it('never changes strings compared with data', () => {
    const blade =
      "@if ($e->estado == 'Activa' && 'Activa' !== $x)\n<p>A acção não é efectiva.</p>\n@endif"
    expect(fix(blade, {path: 'app/views/a.blade.php'})).toBe(
      "@if ($e->estado == 'Activa' && 'Activa' !== $x)\n<p>A ação não é efetiva.</p>\n@endif",
    )
    expect(pairs("if (estado === 'Activa') { return 'Conta activa não' }", {path: 'a.ts'})).toEqual(
      [['activa', 'ativa']],
    )
  })

  it('checks JSX text between tags', () => {
    expect(fix('return <p>O usuário não existe</p>', {path: 'src/page.tsx'})).toBe(
      'return <p>O utilizador não existe</p>',
    )
  })

  it('handles Python, shell and PHP comments and keys', () => {
    expect(
      pairs('# o usuário não existe\nx = {"registro": "Registro"}  # também', {path: 'a.py'}),
    ).toEqual([
      ['usuário', 'utilizador'],
      ['Registro', 'Registo'],
    ])
    expect(pairs('"""\nO usuário não existe.\n"""', {path: 'a.py'})).toEqual([
      ['usuário', 'utilizador'],
    ])
    const php = "<?php\n#[Route('/registro')]\nreturn ['registro' => 'O registro não existe'];"
    expect(pairs(php, {path: 'app/lang/pt/auth.php'})).toEqual([['registro', 'registo']])
    expect(
      pairs('<h1>O usuário não existe</h1>\n<?php echo $usuario ?>', {path: 'view.php'}),
    ).toEqual([['usuário', 'utilizador']])
  })

  it('checks YAML values, gettext msgstr and XML text', () => {
    expect(pairs('registro: O registro não existe # também', {path: 'pt.yml'})).toEqual([
      ['registro', 'registo'],
    ])
    expect(pairs('- O usuário não existe', {path: 'docs.yaml'})).toEqual([
      ['usuário', 'utilizador'],
    ])
    const po = 'msgid "O usuário não existe"\nmsgstr "O usuário não existe"\n"e o registro também"'
    expect(pairs(po, {path: 'pt.po'})).toEqual([
      ['usuário', 'utilizador'],
      ['registro', 'registo'],
    ])
    expect(
      pairs('<source>O usuário não existe</source><target>O usuário não existe</target>', {
        path: 'pt.xlf',
      }),
    ).toEqual([['usuário', 'utilizador']])
    expect(
      pairs('<p title="O usuário não existe">O registro não existe</p>', {path: 'a.html'}),
    ).toEqual([
      ['usuário', 'utilizador'],
      ['registro', 'registo'],
    ])
    expect(
      pairs('<script>const usuário = 1 // não</script><p>Não há</p>', {path: 'a.html'}),
    ).toEqual([])
  })

  it('ignores code, quotes and URLs in Markdown', () => {
    const md = [
      'O `usuário` e o «usuário» não contam, nem usuário → utilizador.',
      'Vê https://exemplo.pt/usuário/registro e não mais.',
      '```',
      'o usuário não existe',
      '```',
      'O registro não existe.',
    ].join('\n')
    expect(pairs(md, {path: 'README.md'})).toEqual([['registro', 'registo']])
  })

  it('skips unsupported files, code-like neighbours and overlaps', () => {
    expect(pairs('O usuário não.', {path: 'a.css'})).toEqual([])
    expect(pairs('O usuário(s) não existe.')).toEqual([])
    expect(pairs('Me registrar não foi fácil.')).toEqual([['Me registrar', 'Registrar-me']])
  })

  it('reports line and column', () => {
    const [finding] = lintText('Olá.\nNão há o usuário.')
    expect(finding).toMatchObject({line: 2, column: 10, rule: 'br'})
  })
})

describe('performance', () => {
  it('stays linear on long masked or minified text', () => {
    const minified = `var a=1;${' '.repeat(200_000)}.Me diga;${'if(a<b&&c>d){x()}'.repeat(20_000)}`
    const start = performance.now()
    lintText(minified, {path: 'vendor.js'})
    lintText(`Não há.${' '.repeat(200_000)}Me diga em Outubro.`)
    expect(performance.now() - start).toBeLessThan(2000)
  })

  // Each case once made a regex quadratic on Node 22 (whose regex engine CI uses): a long run of
  // one character after a prefix. 20 000 characters take milliseconds when linear and seconds
  // when quadratic.
  it.each([
    ['a.md', '', 'a.'],
    ['a.md', '', '«'],
    ['a.md', 'Não há.', ' '],
    ['a.js', '//', '{'],
    ['a.yml', '', ' '],
    ['a.html', '<?php ', '='],
    ['a.html', '<p title="', '('],
  ])('stays linear on %s after %j with a run of %j', (path, prefix, run) => {
    const start = performance.now()
    lintText(`${prefix}${run.repeat(20_000)}Me diga.`, {path})
    expect(performance.now() - start).toBeLessThan(1000)
  })
})

describe('configuration', () => {
  it('honours allowed words and disabled rules', () => {
    const text = 'O usuário não abriu a tela em Outubro.'
    expect(pairs(text, {config: {allow: ['Tela'], disable: ['month-case']}})).toEqual([
      ['usuário', 'utilizador'],
    ])
  })

  it('honours disable markers', () => {
    expect(
      pairs('O usuário não existe. // pt-pt-lint-disable-line\nO registro não existe.'),
    ).toEqual([['registro', 'registo']])
    expect(pairs('pt-pt-lint-disable-file\nO usuário não existe.')).toEqual([])
  })

  it('fixes idempotently and counts fixes', () => {
    const once = fixText('O usuário não está fazendo o registro.')
    expect(once).toEqual({text: 'O utilizador não está a fazer o registo.', fixed: 3})
    expect(fixText(once.text)).toEqual({text: once.text, fixed: 0})
  })
})
