# Changelog

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
