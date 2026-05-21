---
type: slice
slice_id: 007-display-color-bar-menu-writes
title: Display, color, and bar menu writes
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - InteractiveSettingsMenu
  - UsageConfigStore
acceptance_criteria:
  - story: 8
    ac: 1
  - story: 8
    ac: 2
  - story: 8
    ac: 3
  - story: 8
    ac: 4
  - story: 8
    ac: 5
  - story: 8
    ac: 6
  - story: 8
    ac: 7
  - story: 9
    ac: 1
  - story: 9
    ac: 2
  - story: 9
    ac: 4
  - story: 9
    ac: 5
  - story: 10
    ac: 1
  - story: 10
    ac: 2
  - story: 10
    ac: 4
  - story: 10
    ac: 5
  - story: 11
    ac: 1
  - story: 11
    ac: 2
  - story: 21
    ac: 6
blocked_by:
  - 005-config-preset-validation
  - 006-settings-list-menu-shape
created: 2026-05-21
---

# Display, color, and bar menu writes

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Implement the menu value mapping for Display, Color scheme, Bar style, and Bar width. These rows should display current values correctly, expose only approved selectable values, and produce the exact config patches described by the PRD.

## Modules touched

- **`InteractiveSettingsMenu`** — translate the first four row selections into config patches and show JSON-only custom states safely.
- **`UsageConfigStore`** — accept the known patches and preserve the JSON-only custom values that remain valid outside the menu.

## Architecture notes

Keep row-specific mapping logic small and data-driven where practical. Do not let custom JSON values become selectable menu presets; they may be shown as current state only where the PRD allows it.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 8, AC 1) The Display row values are exactly `On`, `Off`, and `Always`.
- [ ] (Story 8, AC 2) The Display current value is `Off` when `enabled === false`.
- [ ] (Story 8, AC 3) The Display current value is `Always` when enabled and `display.showAlways === true`.
- [ ] (Story 8, AC 4) The Display current value is `On` otherwise.
- [ ] (Story 8, AC 5) Selecting `On` writes `{ enabled: true, display: { showAlways: false } }`.
- [ ] (Story 8, AC 6) Selecting `Off` writes `{ enabled: false, display: { showAlways: false } }`.
- [ ] (Story 8, AC 7) Selecting `Always` writes `{ enabled: true, display: { showAlways: true } }`.
- [ ] (Story 9, AC 1) The Color scheme selectable values are exactly `traffic`, `cyan`, `green`, `mono`, and `none`.
- [ ] (Story 9, AC 2) Selecting a Color scheme value writes `colors.scheme` to the selected preset.
- [ ] (Story 9, AC 4) If the current config is `custom`, the menu may display `custom (JSON)` as the current Color scheme value.
- [ ] (Story 9, AC 5) Selecting any Color scheme preset while the current config is `custom` replaces `custom` with that preset.
- [ ] (Story 10, AC 1) The Bar style selectable values are exactly `blocks`, `thin`, `ascii`, `dots`, `squares`, and `braille`.
- [ ] (Story 10, AC 2) Selecting a Bar style value writes `bar.style` to the selected preset.
- [ ] (Story 10, AC 4) If the current config is `custom`, the menu may display `custom (JSON)` as the current Bar style value.
- [ ] (Story 10, AC 5) Selecting any Bar style preset while the current config is `custom` replaces `custom` with that preset.
- [ ] (Story 11, AC 1) The Bar width selectable values are exactly `4`, `6`, `8`, `10`, `12`, `16`, and `20`.
- [ ] (Story 11, AC 2) Selecting a Bar width value writes `bar.width` as the corresponding number.
- [ ] (Story 21, AC 6) Tests verify color scheme and bar style menus expose only presets while JSON `custom` still normalizes and displays safely.

## Blocked by

- `005-config-preset-validation` — menu presets should share config-store validation.
- `006-settings-list-menu-shape` — the SettingsList row model must exist before individual row writes are implemented.
