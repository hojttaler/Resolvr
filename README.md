# Resolvr — desktop GraphQL client and IDE

[![Latest release](https://img.shields.io/github/v/release/hojttaler/Resolvr?label=release)](https://github.com/hojttaler/Resolvr/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/hojttaler/Resolvr/total)](https://github.com/hojttaler/Resolvr/releases)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-informational)](#install)
[![License: FSL-1.1-Apache-2.0](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue)](LICENSE.md)

**Resolvr is a free desktop GraphQL client for macOS, Linux and Windows that never loses
your state — and that an AI agent can drive through the same engine you use.**

Send queries, mutations and subscriptions, browse the schema, keep collections in git and
turn requests into smoke tests. Tabs and drafts survive restarts and crashes, environments
obtain and refresh tokens by themselves, and a built-in MCP server lets Claude Code and other
AI agents build collections and run tests with every step shown in the app. If you test
GraphQL APIs in Postman, Insomnia, Altair or Apollo Explorer, Resolvr imports your Postman
and Insomnia collections and keeps working the way you do.

**[Download the latest release](https://github.com/hojttaler/Resolvr/releases/latest)** ·
[Install guide](docs/INSTALL.md) · [Русская документация](docs/README.ru.md)

![Resolvr GraphQL client — query, variables and response](docs/screenshots/hero-dark.png)

<details>
<summary>More screens: response search, schema browser, flows report, command palette</summary>

![Tour of the Resolvr GraphQL IDE](docs/screenshots/tour.gif)

| Schema browser | Flows report |
|---|---|
| ![GraphQL schema browser](docs/screenshots/schema-browser.png) | ![GraphQL smoke tests report](docs/screenshots/flows-report.png) |

</details>

## Features

- **Never lose state** — every tab, draft, cursor and panel size is written atomically
  and restored after a crash or `kill -9`. Closing a tab with unsaved changes asks first.
- **Team-friendly storage** — `~/Resolvr/workspaces/<name>/` is plain `.graphql` +
  JSON; clone a workspace from git and you have the team's collections. Personal data
  (secrets, history, layout) is kept out of the shared files.
- **Environments and variables** — one environment for every tab, `{{variable}}`
  autocomplete in the variables editor, unknown names flagged in variables and headers.
  Save any value from a response into a variable, or let an operation store
  `data.login.token` after every run.
- **Environments that log in for you** — a flow obtains the token, the app stores it,
  refreshes it before expiry and retries on auth errors. Production environments are
  marked `PROD` and ask before mutations.
- **Flows as smoke tests** — chain operations, extract values by path, assert on
  responses, run all of them with one click and copy a Markdown report. Renaming an
  operation keeps its flows working.
- **Schema browser** — every type as a documentation page: fields with arguments and
  defaults, deprecations, enum values, implementations and "used in"; type names are links
  with back/forward history. Plus introspection with a freshness indicator, autocomplete
  that scaffolds arguments, click-to-build operations and schema diff after deploys.
- **Large responses** — a virtualized JSON tree stays fast on tens of thousands of nodes;
  search (⌘F), copy the whole response, raw body, headers and timing trace.
- **Import** from Postman (collections and environments) and Insomnia exports.
- **Subscriptions** over `graphql-ws`, copy as curl, `resolvr://` links to share an exact
  request with a colleague, drag-and-drop ordering of operations.
- **AI agent access (MCP)** — an MCP server on the same core: workspaces, operations, runs,
  flows, schema search. Every call must state its intent; the app shows the full activity
  log.
- **Native on every platform** — macOS vibrancy and system accent, light and dark themes,
  Keychain for secrets on macOS; a log file for bug reports everywhere.

## Try it in a minute

Open Resolvr and press **Open the example** on the welcome screen: a workspace on a public
countries API appears with three queries, an environment variable and a smoke flow. Press
⌘↩ (Ctrl+Enter) to run the first one.

## Install

Download from [Releases](https://github.com/hojttaler/Resolvr/releases/latest). The app
updates itself from there.

| Platform | File |
|---|---|
| macOS (Apple Silicon and Intel) | `Resolvr_<version>_universal.dmg` |
| Linux | `.AppImage`, `.deb` or `.rpm` |
| Windows | `_x64-setup.exe` or `.msi` |

macOS builds are not notarized (no Apple Developer account): on first launch right-click →
**Open**, or run `xattr -d com.apple.quarantine /Applications/Resolvr.app`. See
[docs/INSTALL.md](docs/INSTALL.md) for the full walkthrough, including the MCP setup for
Claude Code.

On Linux and Windows there is no native blur, and secrets are kept in the library file
instead of Keychain.

## Develop

```bash
pnpm install
pnpm --filter @resolvr/mock-server start   # test GraphQL server on :4000
pnpm dev                                   # Tauri dev mode

pnpm typecheck && pnpm lint && pnpm test   # before pushing
pnpm install:app                           # build and install into /Applications
pnpm release                               # universal DMG into dist/
```

Screenshots in this README come from the showcase page (`showcase.html`, fixtures only):
`pnpm --filter @resolvr/desktop shots` renders every screen with Playwright, then
`python3 scripts/readme-media.py <shots dir>` resizes them and assembles the GIF.

Requirements: Node.js 20+, pnpm 10, Rust stable; Xcode Command Line Tools on macOS,
WebKitGTK 4.1 on Linux.

| Package | Role |
|---|---|
| `apps/desktop` | Tauri v2 (Rust) + React 19 + CodeMirror 6 |
| `packages/core` | Model, storage, run engine, flows, schema — no Tauri, no Node |
| `packages/mcp-server` | MCP server on top of the core, bundled into the app |
| `tools/mock-server` | Test GraphQL server with subscriptions and login |

Questions and ideas: [Discussions](https://github.com/hojttaler/Resolvr/discussions).
Bugs: [Issues](https://github.com/hojttaler/Resolvr/issues) — attach the log from
**Resolvr → Open Logs**.

## License

Resolvr is source-available under the
[Functional Source License 1.1 with Apache 2.0 future license](LICENSE.md): use it, modify
it and redistribute it for any purpose except offering it as a competing product; each
version becomes Apache 2.0 two years after release. See [CONTRIBUTING.md](CONTRIBUTING.md)
before submitting changes.
