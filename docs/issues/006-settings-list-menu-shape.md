---
type: slice
slice_id: 006-settings-list-menu-shape
title: Exact SettingsList menu shape
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - OpenAIUsageSettingsCommand
  - InteractiveSettingsMenu
  - PackageManifestIntegration
acceptance_criteria:
  - story: 2
    ac: 1
  - story: 2
    ac: 2
  - story: 2
    ac: 3
  - story: 2
    ac: 4
  - story: 6
    ac: 5
  - story: 17
    ac: 6
  - story: 19
    ac: 1
  - story: 19
    ac: 2
  - story: 19
    ac: 3
  - story: 21
    ac: 2
  - story: 21
    ac: 4
blocked_by:
  - 003-diagnostics-reporter
  - 004-one-command-shell
  - 005-config-preset-validation
created: 2026-05-21
---

# Exact SettingsList menu shape

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

In UI-capable sessions, make no-args `/openai-usage-settings` open a Pi custom UI settings list with exactly the ten approved common settings rows. Closing or cancelling the menu should be a no-op. Utility commands and advanced JSON controls stay outside the interactive menu.

## Modules touched

- **`OpenAIUsageSettingsCommand`** — branch no-args behavior to interactive UI only when UI is available.
- **`InteractiveSettingsMenu`** — build the fixed ten-row SettingsList model and handle cancel/close without mutation.
- **`PackageManifestIntegration`** — declare the TUI component package correctly when SettingsList is imported directly.

## Architecture notes

The menu should be a shallow adapter over the config store, not a dumping ground for every config field. Keep row construction in an interactive-menu module so command parsing, config normalization, and presentation do not collapse into one file.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 2, AC 1) With UI available, the command uses Pi custom UI with `SettingsList`.
- [ ] (Story 2, AC 2) The menu contains exactly ten rows, in this order: Display, Color scheme, Bar style, Bar width, 5h display, 7d display, 5h reset display, 7d reset display, Refresh interval, Hide label.
- [ ] (Story 2, AC 3) The menu does not include Help, Refresh now, Show current usage, Diagnostics, raw config, JSON editors, label text, separators, partial bars, color target, gradients, custom editors, or advanced config rows.
- [ ] (Story 2, AC 4) Closing or cancelling the menu does not mutate config.
- [ ] (Story 6, AC 5) Diagnostics are available as a utility subcommand only and are not shown as an interactive menu row.
- [ ] (Story 17, AC 6) Interactive JSON editor rows are not provided.
- [ ] (Story 19, AC 1) If `SettingsList` is imported directly, `@earendil-works/pi-tui` is declared as a peer dependency with version `"*"`.
- [ ] (Story 19, AC 2) `@earendil-works/pi-tui` is not bundled as a runtime dependency.
- [ ] (Story 19, AC 3) `@earendil-works/pi-tui` is added to development dependencies only if local typecheck or tests require direct resolution.
- [ ] (Story 21, AC 2) Tests verify no-args with UI opens exactly the ten approved rows in order.
- [ ] (Story 21, AC 4) Tests verify the menu excludes Help, Refresh now, Show current usage, Diagnostics, JSON editors, raw config, label text, separator, partial bars, color target, and gradient rows.

## Blocked by

- `003-diagnostics-reporter` — diagnostics must already exist as a utility so it can be deliberately absent from the menu.
- `004-one-command-shell` — no-args command branching must start from the single command shell.
- `005-config-preset-validation` — the menu row values should reuse the preset contracts owned by the config store.
