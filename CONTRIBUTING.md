# Contributing Guide

Thank you for your interest in contributing to **WindsurfAPI**. This document explains environment setup, code conventions, and the PR process.

## Prerequisites

- **Node.js ≥ 20**
- **Windsurf Language Server binary** (`language_server_linux_x64`), placed by default at `/opt/windsurf/`
- No `npm install` needed — the project has **zero npm dependencies** and uses only `node:*` built-ins

```bash
git clone https://github.com/<your-fork>/WindsurfAPI.git
cd WindsurfAPI

# Quick start (foreground)
node src/index.js

# Dev mode (auto-restart on file changes)
node --watch src/index.js
```

The service listens on `http://0.0.0.0:3003` by default; the Dashboard is at `/dashboard`.

## Code Conventions

### Zero npm Dependencies

- **Do not** add any `npm install <xxx>`. Need HTTP/protobuf/crypto? Use `node:https` / hand-roll varint / `node:crypto`
- This is a deliberate design tradeoff: small attack surface, fast startup, simple deployment
- The `dependencies` field in `package.json` must remain empty (CI enforces this)

### Code Style

- ES modules (`import`/`export`), no CommonJS
- Comments and all text in **English**
- Variable names in camelCase, classes in PascalCase
- All error logs go through `log.info/warn/error/debug` (from `src/config.js`)

### File Organization

Refer to the module breakdown in `ARCHITECTURE.md`. For new features:

- HTTP route entry → `src/server.js`
- Request handling logic → `src/handlers/*.js`
- Dashboard backend API → `src/dashboard/api.js`
- Dashboard frontend → `src/dashboard/index.html`
- Persisted state → separate `*.json` files (add to `.gitignore`)

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
feat:     new feature
fix:      bug fix
docs:     documentation
refactor: refactor (no functional change)
perf:     performance improvement
test:     tests
chore:    build / scaffolding
```

Examples:

```text
feat(dashboard): add token usage export/import endpoints
fix(cascade): handle panel-state-not-found on Send retry
```

## PR Checklist

Before submitting a PR:

- [ ] `find src -name '*.js' -exec node --check {} \;` all pass
- [ ] No npm dependencies introduced
- [ ] No hardcoded paths, IPs, or credentials
- [ ] New features documented in README and/or ARCHITECTURE.md
- [ ] Sensitive files (`accounts.json` / `stats.json` / `.env` / `logs/` / `data/`) not committed

## Testing

The project has no formal unit test suite, but key paths can be verified:

### Local Smoke Test

```bash
# Start service
node src/index.js &

# Basic availability
curl -fsS http://localhost:3003/health
curl -fsS http://localhost:3003/v1/models | head -20

# Dashboard login
curl -H "X-Dashboard-Password: $DASHBOARD_PASSWORD" \
  http://localhost:3003/dashboard/api/stats
```

### Chat End-to-End (requires at least one account added)

```bash
curl -sS http://localhost:3003/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"say hi"}],"stream":false}'
```

## Reporting Issues

- **Bugs**: [GitHub Issues](https://github.com/<org>/WindsurfAPI/issues) — please include the last few lines of `logs/error-*.jsonl`
- **Feature requests**: Open an issue describing your use case
- **Security vulnerabilities**: Please contact the maintainer **privately** by email; do not post publicly in Issues

## License

By contributing, you agree to release your code under the MIT License.
