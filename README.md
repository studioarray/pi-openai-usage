# pi-openai-usage

Shows your remaining OpenAI Codex subscription usage in Pi.

```text
Usage: 5h ████████░░ 88% | 7d ███████░░░ 73% | 5h ↺ 42m | 7d ↺ 2d4h
```

## Install

```bash
pi install git:github.com/studioarray/pi-openai-usage
```

## Login

This extension uses Pi's existing OpenAI Codex login. If you have not logged in yet, run:

```text
/login openai-codex
```

## Command

`/openai-usage-settings` is the one public command for OpenAI usage and settings.

Run it with no arguments in Pi's interactive UI to open the settings menu. In non-UI runs, it shows a read-only fallback with the available utility subcommands.

### Utility subcommands

Use utility subcommands when you want a direct status check, refresh, diagnostics, or help:

| Subcommand | What it does |
| --- | --- |
| `usage` | Show cached usage, refreshing first if the cache is missing or stale. |
| `refresh` | Force a usage refresh and show the updated usage status. |
| `diagnostics` | Show setup, auth, config-path, timestamp, and last-error diagnostics without printing tokens. |
| `help` | Show command help for the one-command workflow. |

Example form: `/openai-usage-settings usage`.

### Interactive settings menu

Running `/openai-usage-settings` with no arguments opens a ten-row menu for common settings:

| Row | Visible values |
| --- | --- |
| Display | `On`, `Off`, `Always` |
| Color scheme | `traffic`, `cyan`, `green`, `mono`, `none` |
| Bar style | `blocks`, `thin`, `ascii`, `dots`, `squares`, `braille` |
| Bar width | `4`, `6`, `8`, `10`, `12`, `16`, `20` |
| 5h display | `hidden`, `percent`, `bar`, `bar + percent` |
| 7d display | `hidden`, `percent`, `bar`, `bar + percent` |
| 5h reset display | `hidden`, `countdown`, `clock`, `both` |
| 7d reset display | `hidden`, `countdown`, `clock`, `both` |
| Refresh interval | `15s`, `30s`, `1m`, `2m`, `5m`, `10m` |
| Hide label | `No`, `Yes` |

`Display` controls whether the status line is shown normally, hidden, or always shown. `Hide label` controls the `Usage:` prefix. If a JSON config uses a custom color scheme or custom bar style, the menu may show `custom (JSON)` as the current value; selecting a preset replaces it with that preset.

## Configuration files

Configuration is read from:

1. Project config: `.pi/extensions/pi-openai-usage.json`
2. Global config: `~/.pi/agent/extensions/pi-openai-usage.json`

Project config overrides global config.

Use the interactive menu for common display settings. Advanced visual customization is JSON-file-only: edit the project or global config file for custom label text, widget labels, separators, partial bars, custom bar glyphs, custom color stops or targets, and bar-gradient controls. Slash-command setting writes are not supported.

## Display customization

The default display uses progress bars and percentages:

```text
Usage: 5h ████████░░ 88% | 7d ███████░░░ 73% | 5h ↺ 42m | 7d ↺ 2d4h
```

To simplify it in the interactive menu, set:

- Hide label: `Yes`
- 5h display: `percent`
- 7d display: `percent`
- 5h reset display: `hidden`
- 7d reset display: `hidden`

Result:

```text
5h: 88% | 7d: 73%
```

To use the neutral footer text colour instead of usage-coloured values, set Color scheme to `none`.

## Attribution

Inspired by [`pi-better-openai`](https://github.com/mattleong/pi-better-openai/).
