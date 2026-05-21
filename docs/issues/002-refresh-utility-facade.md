---
type: slice
slice_id: 002-refresh-utility-facade
title: Refresh utility facade with shared coordinator
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - ExtensionRegistration
  - OpenAIUsageSettingsCommand
  - UsageCommandFacade
acceptance_criteria:
  - story: 5
    ac: 1
  - story: 5
    ac: 2
  - story: 5
    ac: 3
  - story: 5
    ac: 4
  - story: 5
    ac: 5
  - story: 21
    ac: 14
blocked_by:
  - 001-usage-utility-facade
created: 2026-05-21
---

# Refresh utility facade with shared coordinator

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Move the old force-refresh behavior behind `/openai-usage-settings refresh`, using the same command facade path as `usage` but forcing refresh and joining any in-flight shared refresh.

## Modules touched

- **`ExtensionRegistration`** — keep passing the same usage state and refresh coordinator used by the status controller into settings command utilities.
- **`OpenAIUsageSettingsCommand`** — dispatch `refresh` to the facade without recreating refresh infrastructure.
- **`UsageCommandFacade`** — force refresh, join in-flight work, and render the same success/failure status text as the old refresh command.

## Architecture notes

There must be exactly one refresh coordinator instance shared by the status controller and command utilities. Reuse the utility facade created by the usage slice instead of forking refresh result handling.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 5, AC 1) `refresh` forces a usage refresh even when cached usage is fresh.
- [ ] (Story 5, AC 2) Concurrent refresh callers join the shared `UsageRefreshCoordinator` in-flight request instead of creating duplicate fetches.
- [ ] (Story 5, AC 3) The utility subcommand uses the same `usageState` and `UsageRefreshCoordinator` as the status-line controller.
- [ ] (Story 5, AC 4) Refresh success renders the same status text as the old refresh command.
- [ ] (Story 5, AC 5) Refresh failure preserves existing auth-failed, refresh-failed, and cached-with-failure-marker behavior.
- [ ] (Story 21, AC 14) Tests verify `refresh` forces refresh and joins an in-flight refresh through the shared coordinator.

## Blocked by

- `001-usage-utility-facade` — refresh should reuse the shared utility facade and dependency wiring introduced for the usage path.
