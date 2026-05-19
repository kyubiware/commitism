# commit-mint

> A commit tool that actually handles hook failures.

> **⚠️ WORK IN PROGRESS** — This is an early-stage project. The core commit flow, hook error parsing, and recovery menu work, but AI message generation is still a placeholder (`generateMessage` always returns `"chore: initial commit"`). Expect breaking changes.

## The Problem

When `git commit` fails due to pre-commit hooks (lint-staged, biome, eslint, tsc, vitest, jest), you get a wall of raw error output with no clear next step. Your commit message is lost. You fix the errors, try to remember or regenerate the message, and retry manually.

Every existing AI commit tool has the same gap — they generate a message, call `git commit`, and if hooks fail, they just die.

## What commit-mint does differently

commit-mint wraps the entire commit lifecycle — stage, generate, attempt, recover, retry — in one CLI tool:

```
stage files → generate message → attempt commit → hooks fail?
                                                          ├─ copy errors to clipboard
                                                          ├─ skip hooks & commit
                                                          └─ re-stage & retry
```

## Installation

```bash
npm install -g commit-mint
```

Requires **Node.js 18+**.

## Usage

```bash
# Normal commit flow
cmint

# Auto-stage all tracked files
cmint -a

# Skip AI, provide your own message
cmint -m "feat: add dark mode"

# Retry last failed commit (uses cached message)
cmint --retry
cmint -r

# Configuration
cmint config get GROQ_API_KEY
cmint config set GROQ_API_KEY=gsk_...
cmint config set model openai/gpt-oss-20b
```

### First run

If no `GROQ_API_KEY` is set in `~/.commit-mint` or `$GROQ_API_KEY`, you'll be prompted to enter one. It's saved to `~/.commit-mint` for future runs.

## Recovery menu

When a pre-commit hook blocks your commit, commit-mint parses the error output and presents an interactive menu:

```
╭─────────────────────────────────────────────────╮
│  ✘ Pre-commit hook failed                       │
│                                                  │
│  • biome: src/cli.ts — unused variable           │
│  • vitest: 1 test failed in test/cli.test.ts     │
│                                                  │
│  What do you want to do?                         │
│                                                  │
│    Copy error report to clipboard                │
│    Skip hooks and commit (--no-verify)           │
│    Re-stage files and retry                      │
│    Edit commit message                           │
│    Cancel                                        │
╰─────────────────────────────────────────────────╯
```

| Option | What it does |
|--------|-------------|
| **Copy error report** | Copies parsed, clean error output to clipboard — paste it into another terminal for an AI agent to fix |
| **Skip hooks** | Re-runs `git commit --no-verify` with the same message — for when hooks are wrong or you'll fix later |
| **Re-stage & retry** | Runs `git add -A` again (picks up fixes made in another terminal), then retries the commit |
| **Edit message** | Opens a prompt to modify the commit message, then retries |
| **Cancel** | Exits. Commit message is cached for `cmint --retry` |

### Supported hook tools

commit-mint parses errors from:

- **lint-staged** — task failure detection
- **biome** — lint/format errors with file:line:col
- **TypeScript** (`tsc`) — type errors with TS error codes
- **vitest** / **jest** — test failure detection
- **ESLint** — lint error/warning detection

Unrecognized error output is shown as raw fallback.

## Configuration

Stored in `~/.commit-mint` (INI format):

```ini
GROQ_API_KEY=gsk_...
model=openai/gpt-oss-20b
locale=en
max-length=100
type=conventional
timeout=10000
```

| Key | Default | Description |
|-----|---------|-------------|
| `GROQ_API_KEY` | — | Groq API key for AI message generation |
| `model` | `openai/gpt-oss-20b` | AI model for commit message generation |
| `locale` | `en` | Locale for generated messages |
| `max-length` | `100` | Max commit message length |
| `type` | — | Commit type prefix (e.g. `conventional`) |
| `timeout` | `10000` | AI request timeout (ms) |

You can also set `GROQ_API_KEY` via environment variable.

## CLI reference

```
cmint --help

  cmint

  A commit tool that actually handles hook failures

  Options:
    --retry, -r      Retry the last failed commit (default: false)
    --all, -a        Auto-stage all tracked files (default: false)
    --message, -m    Provide a commit message directly (skip AI generation)
    --help, -h       Show help
    --version, -v    Show version

  Commands:
    config           Get/set configuration values
```

## Retry persistence

Failed commit messages are cached to `~/.cache/commit-mint/<repo-hash>.json`. Running `cmint --retry` reuses the last message without regenerating — useful after fixing errors flagged by the recovery menu.

## How it works

```
commit-mint/
├── src/
│   ├── cli.ts              # Entry point, argument parsing (cleye)
│   ├── commands/
│   │   ├── commit.ts       # Main commit flow orchestrator
│   │   └── config.ts       # Config get/set subcommand
│   ├── services/
│   │   ├── git.ts          # Git operations (stage, commit, diff, HEAD)
│   │   ├── hooks.ts        # Hook error parser (lint-staged, biome, tsc, etc.)
│   │   ├── config.ts       # INI config read/write at ~/.commit-mint
│   │   └── clipboard.ts    # Cross-platform clipboard (xclip/wl-copy/pbcopy)
│   ├── ui/
│   │   └── menu.ts         # Interactive recovery TUI (@clack/prompts)
│   └── utils/
│       └── cache.ts        # Commit message persistence at ~/.cache/commit-mint/
```

## Key differentiators

1. **Hook error parsing** — No other commit tool parses lint-staged/biome/eslint output into a clean summary
2. **Interactive recovery menu** — Copy/skip/retry as an in-flow choice, not a manual post-mortem
3. **Message caching on failure** — `--retry` restores the last message without regenerating
4. **Re-stage & retry loop** — Fix errors in another terminal, come back, hit "re-stage & retry"
5. **Clipboard integration** — Copy error report and hand it to an AI coding agent for fixes

## Requirements

- **Node.js 18+**
- **Git** (any modern version)
- **Linux** (primary target; macOS works via `pbcopy`; WSL untested)
- **xclip**, **wl-copy**, **xsel**, or **pbcopy** for clipboard support

## Non-goals

- Not a hook manager — use husky, lefthook
- Not a linter/formatter — use biome, eslint, prettier
- Not a git TUI — use lazygit, gitui
- Not a commitizen replacement — just generates conventional commit messages via AI

## License

MIT © kyubiware
