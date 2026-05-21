---
type: slice
slice_id: 009-menu-write-safety-reapply
title: Menu write safety and status-line reapply
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - InteractiveSettingsMenu
  - UsageConfigStore
  - StatusLineReapply
acceptance_criteria:
  - story: 16
    ac: 1
  - story: 16
    ac: 2
  - story: 16
    ac: 3
  - story: 16
    ac: 4
  - story: 16
    ac: 5
  - story: 16
    ac: 6
  - story: 21
    ac: 5
  - story: 21
    ac: 8
  - story: 21
    ac: 9
  - story: 21
    ac: 10
blocked_by:
  - 007-display-color-bar-menu-writes
  - 008-widget-refresh-label-menu-writes
created: 2026-05-21
---

# Menu write safety and status-line reapply

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Finish the end-to-end menu write contract across all ten rows: every successful selection patch-writes the selected JSON config file, preserves unknown data, calls the config-change callback, and immediately reapplies the status-line controller. Cancelled, failed, and invalid interactions must not trigger config-change side effects.

## Modules touched

- **`InteractiveSettingsMenu`** — centralize successful/failed/cancelled write handling for all rows.
- **`UsageConfigStore`** — patch-write into the selected project/global target while preserving unknown top-level and nested fields.
- **`StatusLineReapply`** — invoke the status controller reapply path only after successful writes.

## Architecture notes

This is the integration slice that proves row mapping plus persistence plus reapply work as one path. Keep status-line reapply as a callback boundary from command/menu code rather than coupling the menu directly to controller internals.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 16, AC 1) Every successful menu write patch-writes the JSON config rather than replacing the full config object.
- [ ] (Story 16, AC 2) Writes use the config store's selected target config file, preserving the existing project-over-global selection behavior and creating the target file's parent directories when needed.
- [ ] (Story 16, AC 3) Unknown top-level and nested fields in the target JSON config file are preserved.
- [ ] (Story 16, AC 4) After every successful menu write, `onConfigChanged(ctx)` is called.
- [ ] (Story 16, AC 5) The status-line controller reapplies immediately after `onConfigChanged(ctx)`.
- [ ] (Story 16, AC 6) Failed, cancelled, or invalid menu interactions do not call `onConfigChanged(ctx)`.
- [ ] (Story 21, AC 5) Tests verify each menu row writes the exact patches described in this PRD.
- [ ] (Story 21, AC 8) Tests verify menu writes preserve unknown config fields.
- [ ] (Story 21, AC 9) Tests verify `onConfigChanged` is called after successful menu writes.
- [ ] (Story 21, AC 10) Tests update status-line reapply coverage to trigger a successful menu write rather than removed `set` behavior.

## Blocked by

- `007-display-color-bar-menu-writes` — first-row mappings must exist before whole-menu write safety can be proven.
- `008-widget-refresh-label-menu-writes` — remaining row mappings must exist before tests can verify every row patch.
