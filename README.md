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

## Commands

### Usage

```text
/openai-usage
/openai-usage refresh
/openai-usage debug
/openai-usage help
```

| Command | What it does |
| --- | --- |
| `/openai-usage` | Show cached usage, refreshing first if needed. |
| `/openai-usage refresh` | Force a usage refresh. |
| `/openai-usage debug` | Show config paths, auth diagnostics, timestamps, and the last error. |
| `/openai-usage help` | Show command help. |

### Settings

```text
/openai-usage-settings
/openai-usage-settings show
/openai-usage-settings diagnostics
/openai-usage-settings set <key> <value>
/openai-usage-settings help
```

Useful examples:

```text
/openai-usage-settings set display.showAlways true
/openai-usage-settings set display.showLabel false
/openai-usage-settings set display.label OpenAI
/openai-usage-settings set bar.style dots
/openai-usage-settings set bar.width 8
/openai-usage-settings set colors.scheme none
/openai-usage-settings set widgets.sevenDayReset.enabled false
```

## Configuration files

Configuration is read from:

1. Project config: `.pi/extensions/pi-openai-usage.json`
2. Global config: `~/.pi/agent/extensions/pi-openai-usage.json`

Project config overrides global config.

Common settings include:

- `enabled`
- `refreshIntervalMs`
- `display.showAlways`
- `display.showLabel`
- `display.label`
- `display.separator`
- widget visibility and modes for the 5h, 7d, and reset displays
- `bar.style`, `bar.width`, `bar.partials`
- `colors.scheme`, `colors.target`, and bar-gradient settings

Advanced settings such as custom colors, custom bars, and full config patches are available through `/openai-usage-settings set` with JSON values.

## Display customization

The default display uses progress bars and percentages:

```text
Usage: 5h ████████░░ 88% | 7d ███████░░░ 73% | 5h ↺ 42m | 7d ↺ 2d4h
```

You can simplify it:

```text
/openai-usage-settings set display.showLabel false
/openai-usage-settings set widgets.fiveHour.mode percent
/openai-usage-settings set widgets.sevenDay.mode percent
/openai-usage-settings set widgets.fiveHourReset.enabled false
/openai-usage-settings set widgets.sevenDayReset.enabled false
```

Result:

```text
5h: 88% | 7d: 73%
```

Disable colors with:

```text
/openai-usage-settings set colors.scheme none
```

## Attribution

Inspired by [`pi-better-openai`](https://github.com/mattleong/pi-better-openai/).
