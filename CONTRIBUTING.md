# Contributing to RAG-A2A

Thanks for your interest in contributing! This guide covers setup, testing, and the PR process.

## Local Setup

```bash
# Clone the repo
git clone https://github.com/aviraldua93/rag-a2a.git
cd rag-a2a

# Install dependencies (requires Bun ≥ 1.0)
bun install

# Start development server (hot-reload)
bun run dev
```

The server starts on `http://localhost:3737` by default.

## Running Tests

```bash
# Unit tests
bun test

# End-to-end (Playwright)
bunx playwright install --with-deps chromium
bunx playwright test

# Type-check only
bun x tsc --noEmit
```

All tests must pass before submitting a PR.

## PR Process

1. **Fork** the repository and create a feature branch from `main`.
2. Make your changes with clear, focused commits.
3. Ensure **all tests pass** (`bun test` and `bunx playwright test`).
4. Ensure **type-checking passes** (`bun x tsc --noEmit`).
5. Open a Pull Request against `main` with a descriptive title and summary.
6. A maintainer will review your PR. Address any feedback promptly.

## Coding Standards

- **TypeScript strict mode** — the project uses `strict: true` in `tsconfig.json`.
- Use `import type` for type-only imports to keep runtime bundles clean.
- Add **JSDoc comments** for all exported functions, classes, and interfaces.
- Prefer explicit return types on public API functions.
- Follow the existing code style; the project does not currently enforce a formatter, but consistency matters.

## Issue Templates

When filing bugs or feature requests, please include:

- **Bug reports**: Steps to reproduce, expected vs actual behaviour, environment (OS, Bun version).
- **Feature requests**: Use case, proposed API surface, and any alternatives considered.

## Questions?

Open a [Discussion](https://github.com/aviraldua93/rag-a2a/discussions) or file an issue.
