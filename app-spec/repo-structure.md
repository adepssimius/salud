# Repo Structure (Nx Monorepo)

- Use Nx to manage a monorepo with separate projects.
- API: NestJS app (e.g., `apps/api`), with its own unit/integration test targets.
- UI: Angular app (e.g., `apps/web`), with its own component/e2e test targets.
- Keep test suites as dedicated Nx projects where helpful (e.g., `apps/api-e2e`, `apps/web-e2e`).
- Shared code lives in `libs/` (types, utilities, UI components).
- Tooling (lint, format, test, build, serve) should be wired as Nx targets per project.
- Yarn is the package manager for the workspace (use the version set in `.tool-versions`).
- The repo mandates `asdf` for tool management so Node/Yarn versions from `.tool-versions` are automatically picked up.
