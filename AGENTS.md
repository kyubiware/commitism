# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-18
**Commit:** f3bff6a
**Branch:** main

## OVERVIEW

CLI tool that wraps `git commit` with AI-generated messages (Groq) and an interactive recovery menu for pre-commit hook failures (lint-staged, biome, eslint, tsc, vitest, jest). TypeScript/ESM, built with tsup.

## STRUCTURE

```
commitism/
├── src/
│   ├── cli.ts              # Entry point (cleye CLI parser)
│   ├── commands/
│   │   ├── commit.ts       # Main commit flow: stage → generate → commit → recover
│   │   └── config.ts       # `commitism config get/set` subcommand
│   ├── services/
│   │   ├── git.ts          # Git operations (stage, diff, commit, HEAD)
│   │   ├── hooks.ts        # Hook error parser (lint-staged, biome, tsc, vitest, eslint)
│   │   ├── config.ts       # INI config at ~/.commitism
│   │   └── clipboard.ts    # Cross-platform clipboard (xclip/wl-copy/pbcopy)
│   ├── ui/
│   │   └── menu.ts         # Recovery TUI (copy/skip/retry/edit/cancel)
│   └── utils/
│       └── cache.ts        # Commit message persistence at ~/.cache/commitism/
├── biome.json              # Formatter: tabs, 100 char width
├── tsconfig.json           # ES2022, ESNext modules, strict
└── package.json            # ESM, bin: commitism → dist/cli.js
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new CLI flag | `src/cli.ts` | Add to `flags` object, pass through to `commitCommand` |
| Change commit flow | `src/commands/commit.ts` | Main lifecycle: retry mode + normal mode |
| Parse a new hook type | `src/services/hooks.ts` | Add parser fn, wire into `parseHookErrors` |
| Add recovery menu option | `src/ui/menu.ts` | Add to options array + switch case |
| Change AI provider | `src/commands/commit.ts` → `generateMessage` | Currently placeholder, uses groq-sdk |
| Config format/defaults | `src/services/config.ts` | INI at `~/.commitism`, defaults at line 19 |
| Cache persistence | `src/utils/cache.ts` | SHA-256 hash of repo path as key |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `commitCommand` | Function | `src/commands/commit.ts:15` | Main commit lifecycle orchestrator |
| `parseHookErrors` | Function | `src/services/hooks.ts:13` | Routes stderr to tool-specific parsers |
| `showRecoveryMenu` | Function | `src/ui/menu.ts:7` | Interactive recovery TUI (recursive on re-stage fail) |
| `attemptCommit` | Function | `src/services/git.ts:76` | `git commit -m`, returns `CommitResult` |
| `getStagedDiff` | Function | `src/services/git.ts:20` | Diff with default excludes (lockfiles, dist, etc.) |
| `KnownError` | Class | `src/services/git.ts:4` | Base error for git-specific failures |
| `HookError` | Interface | `src/services/hooks.ts:3` | `{ tool, message, raw }` error shape |
| `CachedCommit` | Interface | `src/utils/cache.ts:16` | `{ message, timestamp, repoPath }` |
| `Config` | Interface | `src/services/config.ts:9` | Config shape (GROQ_API_KEY, model, locale, etc.) |
| `copyToClipboard` | Function | `src/services/clipboard.ts:3` | Tries wl-copy → xclip → xsel → pbcopy |
| `configCommand` | Command | `src/commands/config.ts:4` | `commitism config get/set` |

## CONVENTIONS

- **Tabs for indentation** (biome.json: `indentStyle: "tab"`)
- **ESM only** — all imports use `.js` extension (`import { x } from "./foo.js"`)
- **Error handling**: `execa` with `reject: false` for expected failures; try/catch with `ExecaError` for commits
- **Config**: INI format at `~/.commitism`, defaults merged via spread
- **Cache**: JSON at `~/.cache/commitism/<sha256-prefix>.json`
- **CLI parsing**: `cleye` library (argv → typed flags)
- **TUI**: `@clack/prompts` for selects/notes/spinners, `kolorist` for colors
- **No index files** — direct imports from module files

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER use `console.log` for user output** — use `@clack/prompts` (intro/outro/note/log) or `kolorist`
- **NEVER use CommonJS syntax** — this is ESM-only (`"type": "module"`)
- **NEVER add clipboard dependencies** — shell out to platform tools (xclip/wl-copy/pbcopy)
- **NEVER modify hook output parsing without testing all 5 parsers** — lint-staged, biome, tsc, vitest/eslint are all interleaved in `parseHookErrors`
- **NEVER hardcode model names** — read from config (`model` key in `~/.commitism`)

## COMMANDS

```bash
npm run build       # tsup src/cli.ts --format esm --dts --clean
npm run dev         # tsup src/cli.ts --format esm --watch
npm run lint        # biome check .
npm run lint:fix    # biome check --fix .
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
```

## NOTES

- `generateMessage()` in `src/commands/commit.ts` is a placeholder — AI integration not yet implemented
- `vision.md` describes full intended architecture; some files listed there don't exist yet (`src/services/ai.ts`, `src/ui/display.ts`, `src/utils/platform.ts`, `src/commands/retry.ts`)
- Config file path: `~/.commitism` (not `~/.config/commitism`)
- Cache path: `~/.cache/commitism/`
- Clipboard tries commands in order: wl-copy → xclip → xsel → pbcopy
- Recovery menu is recursive — re-stage failure re-shows the menu
- `getStagedDiff` excludes: package-lock.json, node_modules, dist, build, .next, coverage, *.log, *.min.js, *.min.css, *.lock, .DS_Store
