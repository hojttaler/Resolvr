# Changelog

## 0.2.0 — 2026-09-22

- Schema browser: a tab per type with fields, arguments, defaults, deprecations, enum
  values, implementations and "used in"; type names are links with back/forward history;
  root fields insert a ready query. The sidebar searches fields across all types and
  groups the rest by kind.
- Virtualized response tree: only the visible rows are rendered, so responses with tens of
  thousands of nodes stay responsive.
- Import from Postman (Collection v2.1, Environment) and Insomnia (export v4).
- First launch: "Open the example" creates a workspace on a public countries API with
  queries, an environment variable and a smoke flow.
- Environments and endpoints can be added, removed and set as default in workspace
  settings.
- README with screenshots and an animated tour.

## 0.1.1 — 2026-09-21

- Interface language: System / English / Russian (Settings → Appearance). The native
  menu follows the choice.
- Keyboard shortcuts follow the platform: ⌘ on macOS, Ctrl on Windows and Linux; menu
  accelerators use CmdOrCtrl.
- Opaque window by default on every platform. Transparency and blur material remain a
  macOS-only option; on Windows the menu bar and window are no longer see-through.
- Release notes for 0.1.0 added to `docs/releases/`.

## 0.1.0 — 2026-09-21

First public version.

- Tabs, drafts, cursor and layout survive restarts and crashes.
- Environments with variables, shared headers, token-refresh flows and prod-guard.
- Flows (chains of operations) as smoke tests, "run all" with a Markdown report.
- Schema introspection, autocomplete, click-to-build operations, schema diff and freshness.
- Subscriptions over graphql-ws, streaming response log.
- Response search (⌘F), copy as curl, `resolvr://` links.
- MCP server bundled in the app: an agent works with the same library and engine; every
  call is narrated in the activity log.
- Secrets in an owner-only library file or macOS Keychain.
