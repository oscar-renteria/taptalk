# TapTalk

TapTalk is a responsive Vue 3 PWA with a Node.js TypeScript API and SQLite persistence for language practice.

## Current status

The workspace foundation is scaffolded. Authentication, vocabulary, learning behavior, and persistence are intentionally not implemented yet.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer

## Development

```sh
cp .env.example .env
npm install
npm run dev
```

The web app runs at `http://localhost:5173`; the API health endpoint is `http://localhost:3000/health`.

## Checks

```sh
npm run build
npm run lint
npm run typecheck
npm test
npm run test:coverage
```

Follow the atomic roadmap prompts in `.roadmap/taptalk_atomic_copilot_prompts.md` and do not move to a later phase before its gate passes.

CI runs linting, formatting, strict typechecking, coverage-enabled tests, and production builds with the same workspace commands.