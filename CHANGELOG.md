# Changelog

## Unreleased

- MCP: the server bundled in the app did not start on Node.js 20 ("Cannot use import
  statement outside a module") — the app now ships it as an ES module package, so
  `claude mcp add resolvr -- node …/mcp/index.js` works on every supported Node version.

## 0.2.5 — 2026-09-23

- Linux: the app could crash with heap corruption (`malloc(): unaligned tcache chunk
  detected`) — the native menu was rebuilt on every start and on every settings change,
  and replacing a GTK menu is fragile. The menu is now built once in the language from
  the settings and rebuilt only when the language actually changes.

## 0.2.4 — 2026-09-23

- Linux: copying to the clipboard did nothing — WebKitGTK rejects the page's clipboard
  API. Copying now goes through the app on every platform.
- Linux with the NVIDIA driver: the interface could crash or turn blank because of the
  WebKitGTK DMA-BUF renderer; it is now turned off when the NVIDIA driver is detected
  (unless `WEBKIT_DISABLE_DMABUF_RENDERER` is set by the user).
- Linux: if the WebKit page process dies, the reason ("crashed" / "exceeded the memory
  limit") is written to the log and the interface reloads instead of staying blank.

## 0.2.3 — 2026-09-23

0.2.2 was tagged but never published: the update manifest job read the files of the draft
release from the releases list, which returns no files for a fresh draft, so the manifest
could not be built. The files are now read from the release itself.

- Response pane: a "Copy" button copies the whole Response / Raw / Headers / Trace tab;
  ⌘A / Ctrl+A selects the tab content (the JSON tree is highlighted and ⌘C copies the full
  text, not only the visible rows).
- Collections: operations are reordered by drag and drop, within a collection and into a
  specific position of another one.
- Closing a tab with unsaved changes asks "Save / Don't save / Cancel"; a new draft opens
  the save dialog and closes after saving.
- Environment variables in requests: `{{` in the variables editor suggests the variables of
  the active environment (secrets masked) and of the prerequisite flow; unknown names are
  underlined, unknown names in headers are listed under the header editor.
- Saving response values to the environment: any value (numbers, booleans, objects as JSON),
  and per-operation rules "after every successful run save `data.…` to `{{variable}}`"
  (the "To environment" tab of a saved operation, or the checkbox in the save dialog).
  Rules also apply to runs through MCP.
- Logs: the app writes a log file (`resolvr.log` in the system log folder) including
  crashes and unhandled UI errors; Settings → About → "Open folder" and the app menu open
  it. A render error shows a recovery screen instead of a blank window.
- Editor search: a redesigned find/replace panel in the app's style — match counter
  ("3 of 12"), case / regexp / whole-word toggles, replace row behind a chevron,
  Enter / Shift+Enter / Esc; labels are translated.
- Fixed: renaming or moving an operation broke flows and login profiles that referenced
  it; references are now rewritten, and a renamed operation keeps its position.
- Fixed: the environment and endpoint were chosen per tab, so two tabs could silently hit
  different environments. The choice is now shared by all tabs of a workspace (the old
  per-tab choice of the active tab is migrated).
- Fixed on Linux: the Window menu did nothing, and "About Resolvr" showed an empty dialog
  with a broken icon.
- Large responses: the Raw tab shows the first 1 MB with a "Show all" button and does not
  re-format bodies over 5 MB; search over the response no longer blocks typing. Copying
  still takes the full text.
- Fixed: saving over an existing operation (in the app or via MCP `operation_save`) dropped
  its description and prerequisite flow.

## 0.2.1 — 2026-09-22

- Fixed "Signature Verification Failed" on update: the release manifest could mix
  signatures from different CI runs of the same tag. It is now built once, after all
  builds, from the signatures next to the uploaded files.

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
- History entries open with their response (body stored up to 512 KB) and are labelled by
  the saved operation name; clicking a saved operation focuses its existing tab.
- Performance: pooled HTTP connections (no TLS handshake per request), parallel reads of
  collections and drafts, fewer re-renders while typing, appended history writes.
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
