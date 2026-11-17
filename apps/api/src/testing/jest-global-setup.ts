// Runs once in Jest's parent process, before any worker starts, so every API test file inherits
// it. Pins the process zone to UTC — what the cluster's api pods resolve (no TZ in the manifests,
// a bookworm-slim base image) — so a test can't pass on a developer's laptop only because the
// laptop's zone happens to match the household's. It has to live here rather than in a
// `setupFiles` entry: Jest gives each test file a sandboxed copy of `process.env`, and a TZ set
// there never reaches Node's clock. See data-model.md → InterventionSchedule.timeZone.
export default function globalSetup() {
  process.env.TZ = 'UTC';
}
