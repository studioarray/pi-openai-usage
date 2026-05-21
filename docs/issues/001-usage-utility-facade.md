---
type: slice
slice_id: 001-usage-utility-facade
title: Usage utility facade under settings command
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - ExtensionRegistration
  - OpenAIUsageSettingsCommand
  - UsageCommandFacade
acceptance_criteria:
  - story: 4
    ac: 1
  - story: 4
    ac: 2
  - story: 4
    ac: 3
  - story: 4
    ac: 4
  - story: 4
    ac: 5
  - story: 4
    ac: 6
  - story: 21
    ac: 13
blocked_by: []
created: 2026-05-21
---

# Usage utility facade under settings command

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Move the old no-argument usage query behavior behind `/openai-usage-settings usage` while the legacy command can still exist temporarily until the final surface-switch slice. This is the walking skeleton for utility behavior: the settings command, shared usage state, refresh coordinator, config loading, auth resolution, and usage formatter all talk to each other through the new facade.

## Modules touched

- **`ExtensionRegistration`** — pass the existing usage state and refresh coordinator into the settings command utility dependencies.
- **`OpenAIUsageSettingsCommand`** — dispatch the `usage` utility subcommand to the usage facade.
- **`UsageCommandFacade`** — encapsulate cache freshness, refresh-before-render, model-specific rendering, auth failure handling, and status text rendering for command use.

## Architecture notes

The facade should be reusable by both `usage` and the later `refresh` utility without depending on a registered legacy command. Keep rendering and refresh decisions in the facade; keep argument parsing in the settings command. Do not create a second `UsageRefreshCoordinator` inside command handling.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 4, AC 1) `usage` shows cached usage when the cache is present and fresh.
- [ ] (Story 4, AC 2) `usage` refreshes before showing usage when the cache is missing or stale.
- [ ] (Story 4, AC 3) Staleness uses the effective `refreshIntervalMs` from config.
- [ ] (Story 4, AC 4) Rendered usage uses the latest effective config after any refresh.
- [ ] (Story 4, AC 5) The current model is respected when rendering model-specific cached usage snapshots.
- [ ] (Story 4, AC 6) Missing Codex credentials produce the existing login-required status, not an unhandled error.
- [ ] (Story 21, AC 13) Tests verify `usage` preserves old `/openai-usage` no-arg behavior.

## Blocked by

None — can start immediately.
