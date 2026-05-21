---
type: slice
slice_id: 010-status-line-regression-sweep
title: Status-line behavior regression sweep
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - ExtensionRegistration
  - UsageCommandFacade
  - UsageConfigStore
  - StatusLineReapply
acceptance_criteria:
  - story: 18
    ac: 3
  - story: 18
    ac: 4
  - story: 18
    ac: 5
  - story: 18
    ac: 6
blocked_by:
  - 001-usage-utility-facade
  - 002-refresh-utility-facade
  - 004-one-command-shell
  - 005-config-preset-validation
  - 009-menu-write-safety-reapply
created: 2026-05-21
---

# Status-line behavior regression sweep

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Run and update the regression surface that proves the refactor changes configuration UX and command placement, not status-line semantics. Fix any drift found in visibility, auth resolution, shared refresh state, usage formatting, colors, progress bars, reset timing, or model-specific display.

## Modules touched

- **`ExtensionRegistration`** — verify status controller wiring remains stable after old command removal.
- **`UsageCommandFacade`** — ensure utility rendering remains compatible with status formatting.
- **`UsageConfigStore`** — ensure preset validation is the only intentional config-driven display semantic change.
- **`StatusLineReapply`** — preserve immediate status updates after config changes.

## Architecture notes

Treat this as a regression guard, not an opportunity to redesign status formatting. Any visible output change outside closed-set validation for invalid config should be considered suspect and either reverted or explicitly justified by an existing PRD AC.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 18, AC 3) Existing config-driven visibility behavior remains in place, including `enabled`, `display.showAlways`, and `display.showLabel` effects.
- [ ] (Story 18, AC 4) Existing auth resolver behavior remains in place.
- [ ] (Story 18, AC 5) Existing refresh coordination and usage-state storage behavior remains in place.
- [ ] (Story 18, AC 6) Existing usage formatting, color, progress-bar, reset-time, and model-specific display behavior is not intentionally changed except where preset validation affects invalid config.

## Blocked by

- `001-usage-utility-facade` — usage rendering must be moved before regression behavior can be checked under the new command.
- `002-refresh-utility-facade` — shared refresh behavior must be in its final command location.
- `004-one-command-shell` — the legacy command must be removed before final status-line behavior is validated.
- `005-config-preset-validation` — the intentional preset-validation differences must be in place.
- `009-menu-write-safety-reapply` — menu write reapply must use the final status-line path.
