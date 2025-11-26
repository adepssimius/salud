# Salud Monorepo

- Nx workspace with separate NestJS API and Angular UI projects, each with their own tests (see `app-spec/` for spec instructions).
- Node version is pinned via `.tool-versions` (Node 22.13.0 with npm 10).

## Getting Started
- Install runtime: `asdf install` (or use your preferred Node 22.13+ install).
- Install dependencies: `npm install`.
- Review specs and LLM usage notes in `app-spec/README.md` before coding.

## Project Layout
- `apps/api` — NestJS API; targets: `serve`, `build`, `lint`, `test`; e2e in `apps/api-e2e`.
- `apps/web` — Angular app with proxy to API; targets: `serve`, `build`, `lint`, `test`; e2e in `apps/web-e2e`.
- `libs/` — shared code goes here (currently empty).

## Common Commands
- `npm run start:api` / `npm run start:web`
- `npm run build:api` / `npm run build:web`
- `npm run test:api` / `npm run test:web`
- `npm run e2e:api` / `npm run e2e:web`
- `npm run lint:api` / `npm run lint:web`
- `npx nx graph` to visualize the workspace.

## Notes
- The web dev server proxies API calls using `apps/web/proxy.conf.json`.
- Keep the specs in `app-spec/` as the source of truth; add product/data/API/UX details there before implementing features.
