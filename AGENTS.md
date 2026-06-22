# Alethe — guia de trabalho (IA)

> Conteúdo idêntico ao [`CLAUDE.md`](CLAUDE.md) deste diretório. Mantenha os dois em sincronia.
> Este é o diretório de trabalho do app. Para contexto amplo do projeto, leia
> [`../docs/CONTEXTO_IA.md`](../docs/CONTEXTO_IA.md).

## 1. O que é

**Alethe** é um app desktop **Windows-first** que organiza, opera e retoma múltiplos agentes de
código (Claude Code, Codex, OpenCode) e shells em paralelo, dentro de uma workspace persistente com
terminais reais (PTYs), layouts, temas, histórico e controle de RAM.

> Tagline: **Reveal the state of every agent, shell, and project.**
> Status: **v1.2.0**, MVP funcional em polish. Identifier: `com.kc1t.alethe`.

## 2. Onde você está

Você está em `public launch/` — o diretório real do app. Aqui ficam:

- `src/` — frontend React.
- `src-tauri/` — backend Rust/Tauri.
- `package.json`, `vite.config.ts`, `tsconfig.json`, `tests/`.

A raiz `poc/` (um nível acima) guarda `README.md`, `docs/`, `.claude/agents/`, `web/` e `landing/`.

## 3. Stack

- **Frontend:** React 18.3 · TypeScript 5.6 · Vite 6 · Zustand 5 · xterm.js 5.5 (`@xterm/addon-fit`, `-search`, `-webgl`) · `react-resizable-panels` · `@dnd-kit/core` · `@radix-ui/react-dialog` · `lucide-react` · `nanoid`.
- **Backend:** Rust (edition 2021) · Tauri 2 · `portable-pty` (ConPTY no Windows) · `tokio` · `reqwest` · `keyring` · `serde`.
- **Estilo:** CSS Modules + CSS custom properties (sem Tailwind, sem styled-components).

## 4. Comandos (de `package.json`)

```powershell
npm install
npm run app      # = tauri dev — roda o app completo com hot reload (FORMA RECOMENDADA)
npm run dev      # só o frontend Vite em http://localhost:1422 (strictPort)
npm run build    # tsc + vite build — o tsc faz typecheck e VALIDA o i18n (ver §5)
npm test         # node --test sobre tests/**/*.test.ts
```

**Build do instalador Windows (MSI/NSIS)** precisa do ambiente MSVC (`vcvars64`):

```powershell
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >NUL && npm run tauri build'
```

Ao retornar o caminho de um instalador gerado, informe sempre o **caminho absoluto completo no PC**
(por exemplo, `D:\projeto\src-tauri\target\release\bundle\nsis\Alethe_setup.exe`), nunca apenas o
caminho relativo ao repositório.

Detalhes em [`../docs/BUILD_WINDOWS.md`](../docs/BUILD_WINDOWS.md).

## 5. Regras inegociáveis

1. **NÃO encerre nem reinicie o app nem o dev server** (`tauri dev` / Vite). Não mate o processo,
   não rode `npm run app` "pra testar" se já estiver rodando. Aplique mudanças via **HMR** e confie no reload.
2. **NÃO faça commit / push / tag / release sem permissão explícita do dono na hora.** Faça as
   alterações **só no working tree** e pare — quem decide commitar é ele.
3. **Design system estrito — sem gradientes, sem "vibecoded".** Nada de UI genérica de template.
   Dashboards e widgets mostram **dado real**, nunca placeholder/mock. Estilo via CSS Modules +
   tokens de `src/styles/theme.css`; **nunca** hardcode de cor — use as variáveis (`--bg`, `--fg`,
   `--accent`, `--agent-*`, `--status-*`, etc.).
4. **i18n obrigatório.** Toda string visível passa por `t()`. Ao adicionar texto, registre a chave
   em `src/lib/i18n/messages/en.ts` (**fonte da verdade**, default EN) **e** em
   `src/lib/i18n/messages/pt-BR.ts`. O `pt-BR.ts` é tipado contra as chaves de `en.ts`, então
   `npm run build` **falha** se faltar tradução.

## 6. Arquitetura rápida

**Frontend (`src/`)**
- `components/` — UI por feature (`HomeView/`, `WorkspaceView/`, `XTermView/`, `ProjectSidebar/`, `TitleBar/`, `modals/`…). 1 `.module.css` por componente.
- `stores/` — Zustand: `projectsStore` (projetos/grupos/terminais/preferences, **persistido** em `projects.json`) e `uiStore` (modais/toasts/efêmero).
- `lib/tauri.ts` — wrapper de `invoke` (todos os comandos do backend passam por aqui).
- `lib/i18n/` — sistema de i18n (`index.ts` + `messages/en.ts` + `messages/pt-BR.ts`).
- `lib/types.ts` — tipos do domínio (`AgentType`, `Terminal`, `Project`, `Group`, `GridLayout`…).
- `styles/theme.css` + `styles/reset.css` — tokens e reset.

**Backend (`src-tauri/src/`)**
- `lib.rs` — `invoke_handler` (registro de todos os `#[tauri::command]`).
- `pty.rs` — spawn/attach/write/resize/restart/kill de PTYs + scrollback em disco.
- `projects.rs` — load/save atômico de `projects.json`. `profiles` — multi-perfil isolado.
- `cli_resolver.rs` — descobre CLIs (pwsh/powershell, Node managers, VS Code) no Windows.
- `claude_sessions.rs` / `codex_sessions.rs` / `claude_usage.rs` — leitura de sessões e uso.
- `spotify.rs`, `backup.rs`, `diagnostics.rs`, `agent_library.rs`, `agent_events.rs`, `stats.rs`.

**Comunicação:** frontend chama `invoke(...)` via `lib/tauri.ts`; o terminal recebe streaming por
eventos Tauri `pty://data/{id}` e `pty://exit/{id}`.

## 7. Convenções

- 1 arquivo `.module.css` por componente; cor/spacing sempre via tokens, nunca literal.
- Tipos novos do domínio em `src/lib/types.ts`; reúse os existentes.
- Selectors Zustand enxutos para evitar loops de rerender; `projects.json` salva com debounce e
  escrita atômica (tmp → rename) — preserve esse padrão.
- Schema de `projects.json` é versionado com migração/backfill — ao mudar shape, mantenha a migração.

## 8. Gotchas / segurança

- `csp: null` em `tauri.conf.json` → o webview tem acesso total ao IPC. Trate qualquer entrada
  renderizada como não-confiável.
- `spawn_pty` executa shell com comando/args vindos do frontend — **valide entrada no front** antes de spawnar.
- Tokens OAuth (Spotify, Claude) ficam em **plaintext** no app data; não logue nem exponha.
- Build Windows exige `vcvars64`. A toolchain Rust em `C:` pode ser corrompida pelo Windows Defender
  — preferir buildar de `D:`.
- Dados locais: `%APPDATA%/Alethe/` (perfis, `projects.json`, scrollback `*.bin`, `spawn.log`).

## 9. Aprofundar

- [`../docs/CONTEXTO_IA.md`](../docs/CONTEXTO_IA.md) — índice de onboarding e mapa de todos os docs.
- [`../docs/GLOSSARY.md`](../docs/GLOSSARY.md) — vocabulário do domínio (Grupo, Projeto, Container, Pane, Terminal, Sub-tab, PTY). **Leitura obrigatória** antes de mexer em workspace/layout.
- [`../docs/FEATURES.md`](../docs/FEATURES.md) — features em detalhe. [`../docs/HANDOFF_STATUS.md`](../docs/HANDOFF_STATUS.md) / [`../docs/CURRENT_STEP.md`](../docs/CURRENT_STEP.md) — estado atual e pendências.
