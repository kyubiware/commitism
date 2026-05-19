# Architecture

## Pattern Overview

**Overall:** CLI command-pipeline with interactive recovery loop

**Key Characteristics:**
- Single-entry orchestrator (`commitCommand`) that stages, generates, attempts, and recovers from hook failures
- Plugin-style error parsers for 5 hook tools (lint-staged, biome, tsc, vitest/jest, eslint)
- 3-tier diff compression for AI prompt efficiency
- Recursive recovery menu that loops until success or cancellation

## Layers

**CLI Layer:**
- Purpose: Parse argv and dispatch to commands
- Location: `src/cli.ts`
- Contains: Flag definitions, command routing
- Depends on: `cleye` library
- Used by: Package binary entry (`dist/cli.mjs`)

**Commands Layer:**
- Purpose: Orchestrate top-level workflows (commit, config)
- Location: `src/commands/`
- Contains: `commit.ts` (main lifecycle), `config.ts` (config get/set)
- Depends on: Services, UI, Utils
- Used by: CLI layer

**Services Layer:**
- Purpose: Encapsulate external system interactions and business logic
- Location: `src/services/`
- Contains: `git.ts` (git operations), `ai.ts` (Groq AI generation), `hooks.ts` (hook error parsing), `config.ts` (INI config), `clipboard.ts` (cross-platform clipboard)
- Depends on: `execa`, `groq-sdk`, `ini`, Node.js built-ins
- Used by: Commands layer

**UI Layer:**
- Purpose: Interactive terminal UI for recovery decisions
- Location: `src/ui/`
- Contains: `menu.ts` (recovery TUI)
- Depends on: `@clack/prompts`, `kolorist`, Services (clipboard, hooks)
- Used by: Commands layer (`commit.ts`)

**Utils Layer:**
- Purpose: Shared utilities with no business logic
- Location: `src/utils/`
- Contains: `cache.ts` (commit message persistence), `debug.ts` (timestamped debug logging)
- Depends on: Node.js built-ins, `kolorist`
- Used by: All other layers

## Data Flow

**Commit Flow (normal mode):**

1. Parse CLI flags — `src/cli.ts`
2. Assert git repo — `src/services/git.ts:assertGitRepo`
3. Auto-stage all tracked files — `src/services/git.ts:stageAll`
4. Get staged diff with exclude patterns — `src/services/git.ts:getStagedDiff`
5. Ensure API key exists (prompt if missing) — `src/services/config.ts:getApiKey` / `setConfigValue`
6. Generate commit message via AI with 3-tier diff compression — `src/services/ai.ts:generateCommitMessage`
7. Present message review (use-as-is / edit / cancel) — `src/commands/commit.ts`
8. Cache commit message — `src/utils/cache.ts:saveCachedCommit`
9. Attempt `git commit -m` with real-time stderr streaming — `src/services/git.ts:attemptCommit`
10. On success: show tool check summary, print "Done." — `src/commands/commit.ts`
11. On failure: parse hook errors — `src/services/hooks.ts:parseHookErrors`
12. Show recovery menu — `src/ui/menu.ts:showRecoveryMenu`

**Recovery Menu Flow:**

1. User chooses action from 5 options — `src/ui/menu.ts`
2. **Copy errors:** format error report → clipboard → exit (for AI agent fix)
3. **Skip hooks:** `git commit --no-verify` — `src/services/git.ts:attemptCommitNoVerify`
4. **Re-stage & retry:** `git add -A` → retry commit; on re-failure, show menu again recursively
5. **Edit message:** prompt new message → retry commit
6. **Cancel:** exit with message cached for `--retry`

**Retry Flow:**

1. Parse `--retry` / `-r` flag — `src/cli.ts`
2. Load cached commit from `~/.cache/commit-mint/<sha256>.json` — `src/utils/cache.ts:loadCachedCommit`
3. Attempt commit; on failure enter recovery menu — same as normal mode steps 9-12

## Key Abstractions

**HookError:**
- Purpose: Structured representation of a single hook failure
- Location: `src/services/hooks.ts:4`
- Pattern: Interface with `{ tool, message, raw }` shape

**ToolCheck:**
- Purpose: Structured representation of a tool's success/failure status in post-commit summary
- Location: `src/services/hooks.ts:171`
- Pattern: Interface with `{ tool, ok }` shape

**CachedCommit:**
- Purpose: Persisted commit message with metadata for `--retry`
- Location: `src/utils/cache.ts:17`
- Pattern: Interface with `{ message, timestamp, repoPath }` shape

**Config:**
- Purpose: User configuration for AI model, locale, max-length, etc.
- Location: `src/services/config.ts:10`
- Pattern: Interface with optional string-keyed properties

**CommitResult:**
- Purpose: Result of a `git commit` attempt including hook stderr
- Location: `src/services/git.ts:78`
- Pattern: Interface with `{ ok, error?, stderr? }`

**KnownError:**
- Purpose: Distinguishable error class for git-specific failures
- Location: `src/services/git.ts:5`
- Pattern: Class extending `Error`

## Entry Points

**cmint CLI:**
- Location: `src/cli.ts`
- Triggers: User runs `cmint` or `cmint --help`
- Responsibilities: Parse argv, set debug flag, dispatch to `commitCommand` or `configCommand`

**commitCommand:**
- Location: `src/commands/commit.ts:26`
- Triggers: `cmint`, `cmint -a`, `cmint -m "..."`, `cmint -r`, `cmint -H "hint"`
- Responsibilities: Orchestrate entire commit lifecycle including retry mode

**configCommand:**
- Location: `src/commands/config.ts:4`
- Triggers: `cmint config get <key>`, `cmint config set <key>=<value>`
- Responsibilities: Read/write `~/.commit-mint` INI values

## Error Handling

**Strategy:** Fail soft with structured feedback and recovery paths

- Git operations use `execa` with `reject: false` for expected failures; `KnownError` for domain-specific errors
- Commit attempts use try/catch with `ExecaError` — collect stderr, return `CommitResult` with `ok: boolean`
- AI errors are mapped to user-friendly messages (invalid key, rate limit, timeout, API error)
- Hook errors are parsed into structured `HookError[]` with a raw fallback for unrecognized output
- Recovery menu provides 5 ways to respond to hook failures (none are dead ends)

## Cross-Cutting Concerns

**Logging:** `src/utils/debug.ts` — module-level boolean gate, timestamped stderr output via `console.error` with `kolorist` dim styling. Enabled by `--debug` / `-d` flag.

**Caching:** `src/utils/cache.ts` — SHA-256 hash of repo path → JSON file in `~/.cache/commit-mint/`. Stores commit message, timestamp, and repo path for `--retry`.

**Storage:** `src/services/config.ts` — INI-format config at `~/.commit-mint`. Defaults merged via spread. Keys: GROQ_API_KEY, model, locale, max-length, type, timeout, proxy.
