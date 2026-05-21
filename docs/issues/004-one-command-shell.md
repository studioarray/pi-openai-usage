---
type: slice
slice_id: 004-one-command-shell
title: One-command shell and removed-path guidance
status: done
slice_type: AFK
parent: openai-usage-settings-refactor
modules_touched:
  - ExtensionRegistration
  - OpenAIUsageSettingsCommand
acceptance_criteria:
  - story: 1
    ac: 1
  - story: 1
    ac: 2
  - story: 1
    ac: 3
  - story: 1
    ac: 4
  - story: 1
    ac: 5
  - story: 3
    ac: 1
  - story: 3
    ac: 2
  - story: 3
    ac: 3
  - story: 3
    ac: 4
  - story: 7
    ac: 1
  - story: 7
    ac: 2
  - story: 7
    ac: 3
  - story: 7
    ac: 4
  - story: 7
    ac: 5
  - story: 7
    ac: 6
  - story: 7
    ac: 7
  - story: 17
    ac: 7
  - story: 18
    ac: 1
  - story: 18
    ac: 2
  - story: 21
    ac: 1
  - story: 21
    ac: 3
  - story: 21
    ac: 11
  - story: 21
    ac: 12
blocked_by:
  - 001-usage-utility-facade
  - 002-refresh-utility-facade
  - 003-diagnostics-reporter
created: 2026-05-21
---

# One-command shell and removed-path guidance

## Parent

Reference to the parent PRD: `openai-usage-settings-refactor` (`docs/prds/openai-usage-settings-refactor.md`).

## What to build

Switch from the temporary dual-surface state to the final public command surface: the extension exposes `/openai-usage-settings` as the only usage/settings command, provides the non-UI no-args fallback and help text, exposes only the supported utility subcommands in completions, and turns removed paths such as `set`, `show`, and `debug` into explicit non-mutating guidance.

## Modules touched

- **`ExtensionRegistration`** — keep status-line registration active while making command registration singular and optional when command APIs are unavailable.
- **`OpenAIUsageSettingsCommand`** — own argument parsing, completions, no-UI fallback, help, unknown-subcommand guidance, and removed-path messages.

## Architecture notes

Apply this slice only after `usage`, `refresh`, and `diagnostics` already work under `/openai-usage-settings`; removing the legacy command should not create a gap in user-visible behavior. Keep status controller registration outside the command-registration branch. Removed command paths must be terminal and non-mutating.

## Acceptance criteria

Drawn directly from the parent PRD:

- [ ] (Story 1, AC 1) The extension registers `openai-usage-settings` as the only public command for usage/settings interaction.
- [ ] (Story 1, AC 2) The extension no longer registers `openai-usage`.
- [ ] (Story 1, AC 3) There are no hidden `openai-usage`, `show`, or `debug` aliases.
- [ ] (Story 1, AC 4) Command completions expose only supported utility subcommands: `usage`, `refresh`, `diagnostics`, and `help`.
- [ ] (Story 1, AC 5) Unknown subcommands produce guidance that points users to `/openai-usage-settings help`.
- [ ] (Story 3, AC 1) Without UI, no-args `/openai-usage-settings` shows a concise read-only fallback explaining that interactive settings require UI.
- [ ] (Story 3, AC 2) The non-UI fallback lists supported utility subcommands: `usage`, `refresh`, `diagnostics`, and `help`.
- [ ] (Story 3, AC 3) The non-UI fallback does not offer or perform config mutation.
- [ ] (Story 3, AC 4) The non-UI fallback does not include removed `show`, `debug`, or `set` guidance.
- [ ] (Story 7, AC 1) `/openai-usage-settings help` describes the one-command surface.
- [ ] (Story 7, AC 2) Help lists only `usage`, `refresh`, `diagnostics`, and `help` utility subcommands.
- [ ] (Story 7, AC 3) Help explains that common settings are interactive through no-args `/openai-usage-settings`.
- [ ] (Story 7, AC 4) Help explains that advanced settings are JSON-file-only.
- [ ] (Story 7, AC 5) Running `/openai-usage-settings set <key> <value>` does not mutate config.
- [ ] (Story 7, AC 6) The removed `set` path tells users slash-command setting writes were removed, settings are interactive now, and advanced settings can be edited in the JSON config file.
- [ ] (Story 7, AC 7) Running `show` or `debug` is not accepted as an alias for settings or diagnostics.
- [ ] (Story 17, AC 7) Slash-command config writes through `set <key> <value>` are not supported anywhere.
- [ ] (Story 18, AC 1) Existing status controller registration remains in place.
- [ ] (Story 18, AC 2) In environments where command registration is unavailable, status controller registration still succeeds and the extension does not throw.
- [ ] (Story 21, AC 1) Tests verify the extension registers `openai-usage-settings` and no longer registers `openai-usage`.
- [ ] (Story 21, AC 3) Tests verify no-args without UI shows the read-only fallback and utility subcommands.
- [ ] (Story 21, AC 11) Tests verify `/openai-usage-settings set <key> <value>` does not mutate config.
- [ ] (Story 21, AC 12) Tests verify `show` and `debug` are not accepted aliases.

## Blocked by

- `001-usage-utility-facade` — usage behavior must already be available under the settings command before the old command is removed.
- `002-refresh-utility-facade` — refresh behavior must already be available under the settings command before the old command is removed.
- `003-diagnostics-reporter` — diagnostics must already be available as a supported utility before the final help/completion surface is locked.
