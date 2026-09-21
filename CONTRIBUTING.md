# Contributing to Resolvr

Thanks for taking the time. A few things to know before opening a pull request.

## License of contributions

Resolvr is source-available under the [Functional Source License 1.1 with Apache 2.0
future license](LICENSE.md). By submitting a contribution you agree that:

- your contribution is licensed under the same terms as the project (FSL-1.1-Apache-2.0),
  and will convert to Apache 2.0 on the same schedule;
- you grant the project maintainer the right to relicense your contribution as part of
  the project, including under commercial terms — this keeps the maintainer's ability to
  offer Resolvr commercially while the code stays open;
- you have the right to submit it (it is your own work, or you are allowed to contribute it).

Every commit must carry a `Signed-off-by` line (`git commit -s`) as a
[Developer Certificate of Origin](https://developercertificate.org) attestation.

## Development setup

```bash
pnpm install
pnpm --filter @resolvr/mock-server start   # test GraphQL server on :4000
pnpm dev                                   # app in dev mode
```

Requirements: Node.js 20+, pnpm 10, Rust stable, Xcode Command Line Tools (macOS).

Before pushing:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

UI changes are verified with screenshots: `pnpm --filter @resolvr/desktop shots` renders
the showcase page (`showcase.html`) with fixtures in both themes.

## Project layout

| Package | Role |
|---|---|
| `apps/desktop` | Tauri v2 (Rust) + React 19 + CodeMirror 6 |
| `packages/core` | Domain model, storage, run engine, flows, schema tools |
| `packages/mcp-server` | MCP server on top of the same core |
| `tools/mock-server` | Test GraphQL server with subscriptions and login |

The core depends on neither Tauri nor Node: transport, secret storage and file system are
behind interfaces (`packages/core/src/ports`). Keep it that way — it is what lets the app
and the agent share one engine.

## Conventions

- TypeScript strict, no `any`; explicit return types on exported functions.
- Comments explain *why*, not *what*. Russian is the working language of the codebase
  comments and UI; English is fine for contributions — we'll translate UI strings.
- One behaviour change per pull request, with a test when the change is in `packages/core`.
- No new abstraction layer for a single implementation.

## Reporting bugs

Open an issue with the diagnostics text from **Settings → About → Copy diagnostics**
(version, OS, library path) and the steps to reproduce. Never paste tokens or responses
that contain personal data — use "Copy as curl (without secrets)".
