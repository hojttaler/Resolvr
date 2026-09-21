# Security

Resolvr stores API tokens locally. Two storage backends are available (Settings → Tokens
and secrets):

- **Library file** (default): `~/Resolvr/.secrets/<workspace>.json`, created with
  owner-only permissions (`0600`). Values are not encrypted — the same threat model as
  SSH keys in `~/.ssh`.
- **macOS Keychain**: system-managed, prompts for a password after each reinstall of an
  ad-hoc-signed build.

Secret values never appear in workspace files, request history, the agent activity log
or MCP responses — they are masked before leaving the run engine.

## Reporting a vulnerability

Please do not open a public issue. Email the maintainer (see the GitHub profile) with a
description and reproduction steps. You will get a reply within a few days.
