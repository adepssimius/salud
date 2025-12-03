# Using the Specs in `app-spec/`

You are building the Salud app strictly from the specs under app-spec/. Treat the markdown files in this folder as the source of truth.

Spec files
- repo-structure.md: Nx monorepo layout with separate NestJS API and Angular UI projects, each with their own test suites.
- security.md: Security requirements (auth, hashing, storage, future encryption for sharing).
- development.md: Local dev instructions (tooling, migrations, seeding test user).
- Add any other specs you need (product, data model, API, UX, etc.); follow them exactly once present.

Rules:
- Read all spec files before coding; if a file is missing or ambiguous, pause and ask for clarification—do not invent behavior.
- Default to the lowest/earliest phase described unless explicitly instructed to work on later phases.
- Follow repo-structure.md and any stack/layout specs provided. If something is absent or incomplete, ask which stack to use.
- Keep changes aligned with the specs; if code and spec diverge, update the spec first (with user approval) or ask for direction.
- Use security/validation/error contracts exactly as defined in the specs.
- Use Yarn for tooling commands (e.g., `yarn <bin> ...`) instead of `npx`.
- Verify critical API behaviors with real curl requests in addition to automated tests (especially access control).

Deliverables:
- Propose a plan before coding.
- Generate code, configuration, tests, and scripts necessary to satisfy the current phase of the specs.
- Provide a brief summary of what was built and how it maps to the spec sections you implemented.
- Do not create commits without explicit user consent.

We are not yet building phase 2, but keep it in mind so that moving in that direction will be easier later.
