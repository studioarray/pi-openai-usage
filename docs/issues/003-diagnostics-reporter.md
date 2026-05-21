---
type: slice
slice_id: 003-diagnostics-reporter
title: Redacted diagnostics utility under settings command
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - OpenAIUsageSettingsCommand
  - DiagnosticsReporter
  - UsageConfigStore
acceptance_criteria:
  - story: 6
    ac: 1
  - story: 6
    ac: 2
  - story: 6
    ac: 3
  - story: 6
    ac: 4
  - story: 21
    ac: 15
blocked_by: []
created: 2026-05-21
---

# Redacted diagnostics utility under settings command

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Implement `/openai-usage-settings diagnostics` as the one-command operational troubleshooting surface, preserving useful old debug information while adding raw config snapshots that are safe to print.

## Modules touched

- **`OpenAIUsageSettingsCommand`** — dispatch `diagnostics` as a utility subcommand only.
- **`DiagnosticsReporter`** — format config, auth, endpoint, runtime, last-fetch, last-success, last-error, effective-setting, and raw-config details.
- **`UsageConfigStore`** — provide raw project/global snapshots and effective config data to diagnostics.

## Architecture notes

Diagnostics formatting should be isolated from command parsing. Redaction must be recursive and conservative for token-like keys and values, including unknown fields in raw config snapshots.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 6, AC 1) `/openai-usage-settings diagnostics` includes config path, project config path, global config path, project/global existence, endpoint, last fetch, last success, last error, auth source, checked auth sources, account ID status, effective enabled state, and effective refresh interval.
- [ ] (Story 6, AC 2) Diagnostics include raw project and global config snapshots.
- [ ] (Story 6, AC 3) Diagnostics include the old debug-style auth/runtime details that remain useful for setup failures.
- [ ] (Story 6, AC 4) Diagnostics never print access tokens, refresh tokens, bearer tokens, API keys, or token-like values, including inside raw config snapshots.
- [ ] (Story 21, AC 15) Tests verify `diagnostics` includes required runtime/config/auth/raw-config data and does not leak tokens.

## Blocked by

None — can start immediately.
