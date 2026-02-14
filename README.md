# Claude Web

A minimal web interface for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI. Runs Claude Code from the browser via a lightweight Node.js server — no frameworks, no build steps, no dependencies.

## Concept

Claude Code is a powerful CLI tool, but sometimes a browser-based chat interface is more convenient. Claude Web bridges this gap by spawning the `claude` CLI as a child process and streaming its structured output (via `--output-format stream-json`) to the browser over Server-Sent Events (SSE).

Each message is a one-shot `claude -p` invocation. The "Continue" toggle adds the `-c` flag to resume the previous session.

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Usage

```bash
# Start with current directory as Claude's working directory
node server.mjs

# Start with a specific working directory
node server.mjs /path/to/your/project
```

Open `http://localhost:3456` in your browser.

### Continue Mode

Click the **Continue** toggle in the header to enable session continuation. When enabled, each message includes `-c` so Claude resumes the previous conversation context.

## Architecture

```
Browser (index.html)
  ↓ POST /api/chat { message, continueSession }
  ↓
Server (server.mjs)
  ↓ spawn("claude", ["-p", message, "--output-format", "stream-json", "--verbose"])
  ↓
Claude Code CLI (child process, cwd = specified directory)
  ↓ stdout: newline-delimited JSON events
  ↓
Server parses JSON → SSE events
  ↓
Browser renders events in real-time
```

### SSE Event Types

| Event | Description |
|-------|-------------|
| `init` | Session ID and model name |
| `assistant` | Text response and/or tool use badges |
| `tool_result` | Output from tool executions |
| `result` | Final result with cost, duration, and turn count |
| `done` | Process exit (code + signal) |
| `error` | Spawn or process errors |

## Source Files

### `server.mjs`

HTTP server with three endpoints:

- `GET /` — Serves `index.html`
- `GET /api/info` — Returns server info (working directory)
- `POST /api/chat` — Spawns `claude` CLI and streams the response

Key implementation details:

- **Nested session prevention**: Removes `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` env vars so the spawned `claude` process doesn't detect itself as nested
- **stream-json parsing**: Buffers stdout line-by-line, parses each JSON event, and transforms it into a simplified SSE format via `formatEvent()`
- **Working directory**: Configurable via CLI argument (`process.argv[2]`), defaults to `process.cwd()`

### `index.html`

Single-file chat UI (HTML + CSS + JS, no build step):

- Dark theme with streaming indicator (green left border)
- IME-safe Enter handling (`e.isComposing` check for Japanese input)
- Tool use badges — shows which tools Claude used (e.g., `Read`, `Bash`, `Grep`)
- Cost/duration footer on each response

## Limitations

- **Read-only by default** — `claude -p` runs non-interactively with stdin closed, so permission prompts cannot be answered. Tools that require permission (Write, Edit, Bash, etc.) are denied automatically. Read, Glob, Grep, and other read-only tools work normally. Toggle **Write: ON** in the header to enable Write, Edit, and Bash via `--allowedTools`.
- **No token-level streaming** — Claude Code's `-p` mode outputs complete messages per event, not individual tokens. Multi-step tasks (tool use) do stream event-by-event.
- **Single request at a time** — concurrent requests are not supported.
- **No authentication** — intended for local use only.

## Port

Default: `3456` (hardcoded in `server.mjs`).
