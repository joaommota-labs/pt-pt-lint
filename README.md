# @joaommotawork/pt-pt-lint

Verifica e corrige texto em português europeu (pt-PT) segundo o Acordo Ortográfico de 1990. Encontra três tipos de problema:

- **Português do Brasil:** vocabulário («usuário», «equipe», «tela»), grafia («contato», «registro», «gênero») e gramática (gerúndio depois de «estar», «Me diga» no início da frase).
- **Grafia anterior ao AO90:** «acção», «óptimo», «actual», «há-de».
- **Meses com maiúscula** a meio da frase («em Outubro»), exceto feriados como «25 de Abril».

Cada ocorrência é **corrigível** (só tem uma leitura em pt-PT e o `--fix` troca-a) ou **para rever** (pode estar certa: «arquivo» é _arquivo_ e não _ficheiro_, «fato» pode ser vestuário, «time» pode ser inglês).

Só lê texto: comentários, strings, texto JSX e HTML, valores de JSON, YAML, `.properties`, `msgstr` de gettext e `<target>` de XLIFF. Nunca altera chaves, identificadores, caminhos ou URLs. Ignora traduções de outras línguas e de pt-BR (`es.json`, `pt-BR/`, `app_pt_BR.ts`) e código minificado.

## CLI

```bash
pnpm exec pt-pt-lint            # ficheiros do repositório Git
pnpm exec pt-pt-lint --fix      # corrige o que é inequívoco
pnpm exec pt-pt-lint --strict   # falha também com o que é para rever
```

Sai com 1 quando há ocorrências corrigíveis (ou qualquer uma, com `--strict`), com 2 em erros de uso.

## Configuração

`.pt-pt-lint.json` na raiz do repositório:

```json
{
  "allow": ["arquivo"],
  "disable": ["month-case"],
  "ignore": ["legacy/**"]
}
```

Regras: `br`, `ao90`, `accent`, `fato`, `time`, `gerund`, `proclisis`, `month-case`. Num ficheiro, `pt-pt-lint-disable-line` ignora a linha e `pt-pt-lint-disable-file` ignora o ficheiro.

## GitHub Actions

```yaml
name: pt-PT
on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review, converted_to_draft]
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  pt-pt:
    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false
    runs-on: ${{ vars.CI_RUNNER == 'self-hosted' && fromJSON('["self-hosted","linux","x64","joao-linux"]') || 'ubuntu-latest' }}
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: joaommotawork/packages/packages/pt-pt-lint@pt-pt-lint-v1
```

Cada ocorrência aparece como anotação na linha: erro se for corrigível, aviso se for para rever.

A tag `pt-pt-lint-v1` só avança quando corre o workflow **pt-pt-lint tag** (Actions → Run workflow), depois dos testes do pacote. Assim, uma alteração na `main` não chega a todos os repositórios ao mesmo tempo. Uma alteração incompatível publica-se numa tag `pt-pt-lint-v2` nova.

## Lefthook

```yaml
pre-commit:
  commands:
    pt-pt:
      run: pnpm exec pt-pt-lint --fix {staged_files}
      stage_fixed: true
```

## Hooks do Claude Code

`pt-pt-lint --hook pre-tool-use` bloqueia escritas e envios (ficheiros, commits, emails, documentos) com texto que não é pt-PT; repetir a mesma chamada em 15 minutos confirma uma forma intencional. `pt-pt-lint --hook stop` pede uma correção quando a última resposta tem problemas.
