---
type: slice
slice_id: 011-document-one-command-workflow
title: Document the one-command workflow
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - UserDocumentation
acceptance_criteria:
  - story: 20
    ac: 1
  - story: 20
    ac: 2
  - story: 20
    ac: 3
  - story: 20
    ac: 4
  - story: 20
    ac: 5
  - story: 20
    ac: 6
  - story: 20
    ac: 7
blocked_by:
  - 001-usage-utility-facade
  - 002-refresh-utility-facade
  - 003-diagnostics-reporter
  - 004-one-command-shell
  - 006-settings-list-menu-shape
  - 009-menu-write-safety-reapply
  - 010-status-line-regression-sweep
created: 2026-05-21
---

# Document the one-command workflow

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Update user-facing documentation so command examples, settings guidance, and advanced customization guidance match the final one-command product.

## Modules touched

- **`UserDocumentation`** — remove stale command examples and document the interactive settings menu, utility subcommands, JSON-only advanced customization, install flow, and Codex login flow.

## Architecture notes

Documentation should describe product behavior rather than implementation internals. Keep advanced settings documented as JSON-file edits, not slash-command writes or interactive editor rows.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 20, AC 1) Documentation removes `/openai-usage`, `/openai-usage refresh`, `/openai-usage debug`, and `/openai-usage help` as public command examples.
- [ ] (Story 20, AC 2) Documentation removes `/openai-usage-settings show` and typed `set` examples.
- [ ] (Story 20, AC 3) Documentation presents `/openai-usage-settings` as the one public command.
- [ ] (Story 20, AC 4) Documentation lists the `usage`, `refresh`, `diagnostics`, and `help` utility subcommands.
- [ ] (Story 20, AC 5) Documentation describes the ten interactive menu rows and their user-visible values.
- [ ] (Story 20, AC 6) Documentation mentions that advanced visual customization is JSON-file-only.
- [ ] (Story 20, AC 7) Installation and Codex login guidance remain intact unless they are already obsolete for unrelated reasons.

## Blocked by

- `001-usage-utility-facade` — usage utility behavior must be available to document.
- `002-refresh-utility-facade` — refresh utility behavior must be available to document.
- `003-diagnostics-reporter` — diagnostics utility behavior must be available to document.
- `004-one-command-shell` — command surface and removed-path guidance must be defined.
- `006-settings-list-menu-shape` — menu rows and values must be stable.
- `009-menu-write-safety-reapply` — write behavior must be final.
- `010-status-line-regression-sweep` — documentation should follow the final validated behavior.
