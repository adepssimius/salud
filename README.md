# Salud Monorepo

- Nx workspace with separate NestJS API and Angular UI projects, each with their own tests (see `app-spec/` for spec instructions).
- Node version is pinned via `.tool-versions` (`22.13.0`); ensure your shell picks it up before running Yarn.

## Getting Started
- Install runtime and pick the right Node:
  - `asdf install` then `asdf shell nodejs 22.13.0` (or ensure `~/.asdf/shims` is first on `PATH` so `.tool-versions` is honored).
  - Confirm with `node -v` → `v22.13.0` before running Yarn.
- Install dependencies: `yarn install`.
- Review specs and LLM usage notes in `app-spec/README.md` before coding.

## Project Layout
- `apps/api` — NestJS API; targets: `serve`, `build`, `lint`, `test`; e2e in `apps/api-e2e`.
- `apps/web` — Angular app with proxy to API; targets: `serve`, `build`, `lint`, `test`; e2e in `apps/web-e2e`.
- `libs/` — shared code goes here (currently empty).

## Common Commands
- `yarn start:api` / `yarn start:web`
- `yarn build:api` / `yarn build:web`
- `yarn test:api` / `yarn test:web`
- `yarn e2e:api` / `yarn e2e:web`
- `yarn lint:api` / `yarn lint:web`
- `yarn nx graph` to visualize the workspace.

## Notes
- The web dev server proxies API calls using `apps/web/proxy.conf.json`.
- Keep the specs in `app-spec/` as the source of truth; add product/data/API/UX details there before implementing features.
