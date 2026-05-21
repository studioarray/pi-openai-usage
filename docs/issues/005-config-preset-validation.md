---
type: slice
slice_id: 005-config-preset-validation
title: Preset validation and JSON-only advanced config support
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - UsageConfigStore
acceptance_criteria:
  - story: 9
    ac: 3
  - story: 10
    ac: 3
  - story: 11
    ac: 3
  - story: 11
    ac: 4
  - story: 11
    ac: 5
  - story: 11
    ac: 6
  - story: 14
    ac: 8
  - story: 14
    ac: 9
  - story: 14
    ac: 10
  - story: 14
    ac: 11
  - story: 17
    ac: 1
  - story: 17
    ac: 2
  - story: 17
    ac: 3
  - story: 17
    ac: 4
  - story: 17
    ac: 5
  - story: 17
    ac: 8
  - story: 17
    ac: 9
  - story: 21
    ac: 7
blocked_by: []
created: 2026-05-21
---

# Preset validation and JSON-only advanced config support

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Harden the config store so JSON loading preserves existing advanced customization while enforcing closed preset sets for bar width and refresh interval. Invalid widths and intervals should fall back to defaults rather than being clamped to arbitrary bounds.

## Modules touched

- **`UsageConfigStore`** — own layered JSON loading, normalization, preset constants, default fallback behavior, and unknown-field-preserving patch writes.

## Architecture notes

Export or centralize the approved bar-width and refresh-interval sets so the menu and normalization share one contract. Keep custom color and custom bar support as normalized JSON states, but do not add any command or menu write path for advanced-only fields.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 9, AC 3) `colors.scheme: "custom"` remains valid when loaded from JSON.
- [ ] (Story 10, AC 3) `bar.style: "custom"` remains valid when loaded from JSON.
- [ ] (Story 11, AC 3) The default bar width is `10`.
- [ ] (Story 11, AC 4) JSON config accepts only approved bar widths.
- [ ] (Story 11, AC 5) Invalid JSON `bar.width` values normalize to `10`.
- [ ] (Story 11, AC 6) Invalid JSON `bar.width` values are not clamped to arbitrary safe bounds.
- [ ] (Story 14, AC 8) The default refresh interval is `60000`.
- [ ] (Story 14, AC 9) JSON config accepts only the approved refresh intervals.
- [ ] (Story 14, AC 10) Invalid JSON `refreshIntervalMs` values normalize to `60000`.
- [ ] (Story 14, AC 11) Invalid JSON `refreshIntervalMs` values are not clamped to arbitrary safe bounds.
- [ ] (Story 17, AC 1) Project and global JSON config files continue to be loaded with project config overriding global config.
- [ ] (Story 17, AC 2) Unknown fields continue to be preserved on patch writes.
- [ ] (Story 17, AC 3) Custom display label text remains supported through JSON only.
- [ ] (Story 17, AC 4) Widget labels and reset widget labels remain supported through JSON only.
- [ ] (Story 17, AC 5) Separator, partial bars, custom bar style, `bar.style: "custom"`, custom color stops, `colors.scheme: "custom"`, `colors.target`, and bar-gradient controls remain supported through JSON only.
- [ ] (Story 17, AC 8) Arbitrary `bar.width` outside `4`, `6`, `8`, `10`, `12`, `16`, and `20` is not supported anywhere.
- [ ] (Story 17, AC 9) Arbitrary `refreshIntervalMs` outside `15000`, `30000`, `60000`, `120000`, `300000`, and `600000` is not supported anywhere.
- [ ] (Story 21, AC 7) Tests verify bar width and refresh interval accept only approved presets and invalid JSON falls back to defaults.

## Blocked by

None — can start immediately.
