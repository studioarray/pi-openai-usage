import { SettingsList, type SettingItem, type SettingsListTheme } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { UsageConfig, WindowWidgetConfig, ResetWidgetConfig } from "./config";

type InteractiveSettingsMenuContext = Pick<ExtensionCommandContext, "ui">;

type PiTheme = {
  fg?: (color: string, text: string) => string;
};

type InteractiveSettingsMenuCallbacks = {
  onCancel?: () => void;
  onChange?: (id: string, newValue: string) => void;
  theme?: SettingsListTheme;
};

const REFRESH_INTERVAL_LABELS = new Map<number, string>([
  [15_000, "15s"],
  [30_000, "30s"],
  [60_000, "1m"],
  [120_000, "2m"],
  [300_000, "5m"],
  [600_000, "10m"],
]);

export async function openInteractiveSettingsMenu(
  ctx: InteractiveSettingsMenuContext,
  config: UsageConfig,
): Promise<void> {
  await ctx.ui.custom<void>((_tui, theme, _keybindings, done) =>
    createInteractiveSettingsMenu(config, {
      onCancel: () => done(undefined),
      theme: createSettingsListTheme(theme as PiTheme),
    }),
  );
}

export function createInteractiveSettingsMenu(
  config: UsageConfig,
  callbacks: InteractiveSettingsMenuCallbacks = {},
): SettingsList {
  const rows = buildInteractiveSettingsRows(config);
  return new SettingsList(
    rows,
    rows.length,
    callbacks.theme ?? createSettingsListTheme(),
    callbacks.onChange ?? (() => undefined),
    callbacks.onCancel ?? (() => undefined),
  );
}

export function buildInteractiveSettingsRows(config: UsageConfig): SettingItem[] {
  return [
    {
      id: "display",
      label: "Display",
      currentValue: formatDisplayValue(config),
    },
    {
      id: "color-scheme",
      label: "Color scheme",
      currentValue: formatJsonOnlyCustomValue(config.colors.scheme),
    },
    {
      id: "bar-style",
      label: "Bar style",
      currentValue: formatJsonOnlyCustomValue(config.bar.style),
    },
    {
      id: "bar-width",
      label: "Bar width",
      currentValue: String(config.bar.width),
    },
    {
      id: "five-hour-display",
      label: "5h display",
      currentValue: formatWindowWidgetValue(config.widgets.fiveHour),
    },
    {
      id: "seven-day-display",
      label: "7d display",
      currentValue: formatWindowWidgetValue(config.widgets.sevenDay),
    },
    {
      id: "five-hour-reset-display",
      label: "5h reset display",
      currentValue: formatResetWidgetValue(config.widgets.fiveHourReset),
    },
    {
      id: "seven-day-reset-display",
      label: "7d reset display",
      currentValue: formatResetWidgetValue(config.widgets.sevenDayReset),
    },
    {
      id: "refresh-interval",
      label: "Refresh interval",
      currentValue: formatRefreshInterval(config.refreshIntervalMs),
    },
    {
      id: "hide-label",
      label: "Hide label",
      currentValue: config.display.showLabel ? "No" : "Yes",
    },
  ];
}

function createSettingsListTheme(theme: PiTheme = {}): SettingsListTheme {
  const fg = (color: string, text: string) =>
    typeof theme.fg === "function" ? theme.fg(color, text) : text;

  return {
    label: (text, selected) => (selected ? fg("accent", text) : text),
    value: (text, selected) => (selected ? fg("accent", text) : fg("muted", text)),
    description: (text) => fg("dim", text),
    cursor: fg("accent", "→ "),
    hint: (text) => fg("dim", text),
  };
}

function formatDisplayValue(config: UsageConfig): string {
  if (!config.enabled) return "Off";
  if (config.display.showAlways) return "Always";
  return "On";
}

function formatWindowWidgetValue(widget: WindowWidgetConfig): string {
  if (!widget.enabled || widget.mode === "hidden") return "hidden";
  if (widget.mode === "bar-percent") return "bar + percent";
  return widget.mode;
}

function formatResetWidgetValue(widget: ResetWidgetConfig): string {
  if (!widget.enabled || widget.mode === "hidden") return "hidden";
  return widget.mode;
}

function formatRefreshInterval(refreshIntervalMs: number): string {
  return REFRESH_INTERVAL_LABELS.get(refreshIntervalMs) ?? `${refreshIntervalMs}ms`;
}

function formatJsonOnlyCustomValue(value: string): string {
  return value === "custom" ? "custom (JSON)" : value;
}
