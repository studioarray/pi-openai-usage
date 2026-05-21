---
type: slice
slice_id: 008-widget-refresh-label-menu-writes
title: Widget, refresh interval, and label menu writes
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - InteractiveSettingsMenu
  - UsageConfigStore
acceptance_criteria:
  - story: 12
    ac: 1
  - story: 12
    ac: 2
  - story: 12
    ac: 3
  - story: 12
    ac: 4
  - story: 12
    ac: 5
  - story: 12
    ac: 6
  - story: 12
    ac: 7
  - story: 12
    ac: 8
  - story: 12
    ac: 9
  - story: 12
    ac: 10
  - story: 13
    ac: 1
  - story: 13
    ac: 2
  - story: 13
    ac: 3
  - story: 13
    ac: 4
  - story: 13
    ac: 5
  - story: 13
    ac: 6
  - story: 13
    ac: 7
  - story: 13
    ac: 8
  - story: 13
    ac: 9
  - story: 14
    ac: 1
  - story: 14
    ac: 2
  - story: 14
    ac: 3
  - story: 14
    ac: 4
  - story: 14
    ac: 5
  - story: 14
    ac: 6
  - story: 14
    ac: 7
  - story: 15
    ac: 1
  - story: 15
    ac: 2
  - story: 15
    ac: 3
  - story: 15
    ac: 4
blocked_by:
  - 005-config-preset-validation
  - 006-settings-list-menu-shape
  - 007-display-color-bar-menu-writes
created: 2026-05-21
---

# Widget, refresh interval, and label menu writes

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Complete the remaining six menu rows: 5h display, 7d display, 5h reset display, 7d reset display, Refresh interval, and Hide label. Each row should expose only the approved values, render current values as the PRD describes, and emit the exact patch for the selected value.

## Modules touched

- **`InteractiveSettingsMenu`** — translate widget, reset widget, refresh interval, and label selections into config patches.
- **`UsageConfigStore`** — accept and normalize the known patches while keeping unsupported advanced controls JSON-only.

## Architecture notes

Use shared helpers for the parallel 5h/7d and reset-widget rows so behavior does not diverge between paired widgets. Refresh interval labels should map through the approved interval table rather than ad hoc parsing.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 12, AC 1) Each 5h and 7d usage display row exposes exactly `hidden`, `percent`, `bar`, and `bar + percent`.
- [ ] (Story 12, AC 2) The 5h display row maps to `widgets.fiveHour.enabled` and `widgets.fiveHour.mode`.
- [ ] (Story 12, AC 3) The 7d display row maps to `widgets.sevenDay.enabled` and `widgets.sevenDay.mode`.
- [ ] (Story 12, AC 4) Selecting `hidden` writes `{ enabled: false, mode: "hidden" }` for the row's widget.
- [ ] (Story 12, AC 5) Selecting `percent` writes `{ enabled: true, mode: "percent" }` for the row's widget.
- [ ] (Story 12, AC 6) Selecting `bar` writes `{ enabled: true, mode: "bar" }` for the row's widget.
- [ ] (Story 12, AC 7) Selecting `bar + percent` writes `{ enabled: true, mode: "bar-percent" }` for the row's widget.
- [ ] (Story 12, AC 8) The current value is `hidden` when the widget is disabled or mode is `hidden`.
- [ ] (Story 12, AC 9) The current value renders `percent` as `percent` and `bar` as `bar`.
- [ ] (Story 12, AC 10) The current value renders `bar-percent` as `bar + percent`.
- [ ] (Story 13, AC 1) Each 5h and 7d reset display row exposes exactly `hidden`, `countdown`, `clock`, and `both`.
- [ ] (Story 13, AC 2) The 5h reset display row maps to `widgets.fiveHourReset.enabled` and `widgets.fiveHourReset.mode`.
- [ ] (Story 13, AC 3) The 7d reset display row maps to `widgets.sevenDayReset.enabled` and `widgets.sevenDayReset.mode`.
- [ ] (Story 13, AC 4) Selecting `hidden` writes `{ enabled: false, mode: "hidden" }` for the row's reset widget.
- [ ] (Story 13, AC 5) Selecting `countdown` writes `{ enabled: true, mode: "countdown" }` for the row's reset widget.
- [ ] (Story 13, AC 6) Selecting `clock` writes `{ enabled: true, mode: "clock" }` for the row's reset widget.
- [ ] (Story 13, AC 7) Selecting `both` writes `{ enabled: true, mode: "both" }` for the row's reset widget.
- [ ] (Story 13, AC 8) The current value is `hidden` when the reset widget is disabled or mode is `hidden`.
- [ ] (Story 13, AC 9) The current value renders `countdown`, `clock`, and `both` as themselves.
- [ ] (Story 14, AC 1) The Refresh interval selectable values are exactly `15s`, `30s`, `1m`, `2m`, `5m`, and `10m`.
- [ ] (Story 14, AC 2) Selecting `15s` writes `refreshIntervalMs: 15000`.
- [ ] (Story 14, AC 3) Selecting `30s` writes `refreshIntervalMs: 30000`.
- [ ] (Story 14, AC 4) Selecting `1m` writes `refreshIntervalMs: 60000`.
- [ ] (Story 14, AC 5) Selecting `2m` writes `refreshIntervalMs: 120000`.
- [ ] (Story 14, AC 6) Selecting `5m` writes `refreshIntervalMs: 300000`.
- [ ] (Story 14, AC 7) Selecting `10m` writes `refreshIntervalMs: 600000`.
- [ ] (Story 15, AC 1) The Hide label row values are exactly `No` and `Yes`.
- [ ] (Story 15, AC 2) The default Hide label value is `No`, meaning the status line includes the label/prefix such as `Usage:`.
- [ ] (Story 15, AC 3) Selecting `No` writes `{ display: { showLabel: true } }`.
- [ ] (Story 15, AC 4) Selecting `Yes` writes `{ display: { showLabel: false } }`.

## Blocked by

- `005-config-preset-validation` — refresh interval values must use the config store's approved set.
- `006-settings-list-menu-shape` — the menu row model must already exist.
- `007-display-color-bar-menu-writes` — reuse the same row-write pattern established for the first menu rows.
