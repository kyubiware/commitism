# commit-mint

> commit-mint groups changed files into individual commits, generates commit messages, and cleanly handles commit hook failures. It wraps the entire commit lifecycle — stage, generate, review, attempt, recover, retry — so you never lose a message or stare at raw hook output again.

## Quick Start

```bash
npm install -g @kyubiware/commit-mint
```

```bash
cmint
```

Requires **Node.js 18+**.

```
stage files → generate message → review message → attempt commit → hooks fail?
                                                                    ├─ copy errors to clipboard
                                                                    ├─ skip hooks & commit
                                                                    ├─ re-stage & retry
                                                                    ├─ edit message
                                                                    └─ cancel (cached for --retry)
```

## Usage

```bash
# Normal commit flow (interactive staging if multiple files)
cmint

# Auto-stage all tracked files (skip staging menu)
cmint -a

# Skip AI, provide your own message
cmint -m "feat: add dark mode"

# Pass context hint to AI for better messages
cmint -H "refactoring auth module"
cmint --hint "splitting monolith into services"

# Retry last failed commit (uses cached message)
cmint --retry
cmint -r

# Review staged changes with AI
cmint --review
cmint -R

# Debug mode — timestamped stderr output
cmint --debug

# Configuration
cmint config get GROQ_API_KEY
cmint config set GROQ_API_KEY=gsk_...
cmint config set model openai/gpt-oss-20b
```

### First run

If no `GROQ_API_KEY` is set in `~/.commit-mint` or `$GROQ_API_KEY`, you'll be prompted to enter one. It's saved to `~/.commit-mint` for future runs.

### Interactive staging

When you have multiple changed files, commit-mint shows an interactive staging menu:

- **Stage all files** — auto-stage everything (same as `cmint -a`)
- **Select files** — multi-select specific files to stage
- **Auto-group into commits** — AI groups files into logical commits (see below)
- **Cancel**

If only one file has changed, it's staged automatically.

### Auto-group

The auto-group feature uses AI to analyze your changed files and group them into logical, cohesive commits. Each group is committed separately with its own AI-generated message.

```
1. AI analyzes changed files → proposes groups (name, description, files)
2. You confirm or cancel the groupings
3. For each group: stage → generate message → review → commit
4. Hook failures show the recovery menu per-group
```

Select "Auto-group into commits" from the staging menu, or it's automatically available when you have multiple changed files.

### Message review

Before every commit, you can review the generated message:

- **Use as-is** — accept the AI-generated message
- **Edit** — modify the message in a prompt
- **Review with OpenCode** — run a code review on your staged changes before committing
- **Cancel** — exit (message is cached for `--retry`)

### Code review

Use `cmint --review` or `cmint -R` to review staged changes without committing. commit-mint checks for [OpenCode](https://github.com/opencode-ai/opencode) first — if available, it uses OpenCode for the review. Otherwise, it falls back to the Groq API.

The review looks for bugs, security issues, performance problems, code quality, and edge cases. Results are shown in a structured report, with an option to copy findings to clipboard.

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
type=conventional
timeout=10000
proxy=
```

| Key | Default | Description |
|-----|---------|-------------|
| `GROQ_API_KEY` | — | Groq API key for AI message generation |
| `model` | `openai/gpt-oss-20b` | AI model for commit message generation |
| `locale` | `en` | Locale for generated messages |
| `type` | — | Commit type prefix (e.g. `conventional`) |
| `timeout` | `10000` | AI request timeout (ms) |
| `proxy` | — | Proxy URL for API requests |

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
    --hint, -H       Add context hint for AI commit message generation
    --review, -R     Review staged changes with a coding model (default: false)
    --debug, -d      Enable debug output (default: false)
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
│   │   ├── auto-group.ts   # Auto-group multi-commit flow
│   │   ├── review.ts       # Code review command
│   │   └── config.ts       # Config get/set subcommand
│   ├── services/
│   │   ├── git.ts          # Git operations (stage, commit, diff, HEAD)
│   │   ├── ai.ts           # Groq AI commit message generation (3-tier diff compression)
│   │   ├── grouping.ts     # AI-powered file grouping into logical commits
│   │   ├── review-ai.ts    # AI code review via Groq
│   │   ├── hooks.ts        # Hook error parser (lint-staged, biome, tsc, etc.)
│   │   ├── config.ts       # INI config read/write at ~/.commit-mint
│   │   └── clipboard.ts    # Cross-platform clipboard (xclip/wl-copy/pbcopy)
│   ├── ui/
│   │   ├── menu.ts         # Interactive recovery TUI + staging menu
│   │   ├── grouping.ts     # Grouping confirmation UI
│   │   └── review-message.ts # Message review step (use/edit/review/cancel)
│   └── utils/
│       ├── cache.ts        # Commit message persistence at ~/.cache/commit-mint/
│       └── debug.ts        # Timestamped debug logging to stderr
```

## Key differentiators

1. **Hook error parsing** — No other commit tool parses lint-staged/biome/eslint output into a clean summary
2. **Interactive recovery menu** — Copy/skip/retry/edit as an in-flow choice, not a manual post-mortem
3. **Message caching on failure** — `--retry` restores the last message without regenerating
4. **Re-stage & retry loop** — Fix errors in another terminal, come back, hit "re-stage & retry"
5. **Auto-group** — AI groups changed files into logical commits, each committed separately
6. **In-flow code review** — Review staged changes with OpenCode or Groq before committing
7. **Message review step** — Accept, edit, or review the AI-generated message before committing
8. **Post-commit summary** — Shows which hook tools passed/failed after every successful commit
9. **Clipboard integration** — Copy error report and hand it to an AI coding agent for fixes

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
