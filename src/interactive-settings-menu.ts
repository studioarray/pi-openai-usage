import { SettingsList, type SettingItem, type SettingsListTheme } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  APPROVED_BAR_WIDTHS,
  BAR_STYLE_PRESETS,
  COLOR_SCHEME_PRESETS,
  type ApprovedBarWidth,
  type BarStylePreset,
  type ColorSchemePreset,
  type UsageConfig,
  type UsageConfigPatch,
  type WindowWidgetConfig,
  type ResetWidgetConfig,
} from "./config";

type InteractiveSettingsMenuContext = Pick<ExtensionCommandContext, "ui">;

type PiTheme = {
  fg?: (color: string, text: string) => string;
};

type InteractiveSettingsMenuCallbacks = {
  onCancel?: () => void;
  onChange?: (id: string, newValue: string) => void;
  onPatch?: (patch: UsageConfigPatch) => void;
  theme?: SettingsListTheme;
};

type SettingPatchBuilder = (value: string) => UsageConfigPatch | undefined;

const DISPLAY_VALUES = ["On", "Off", "Always"] as const;
type DisplayValue = (typeof DISPLAY_VALUES)[number];
const BAR_WIDTH_VALUES = APPROVED_BAR_WIDTHS.map(String);
const BAR_WIDTH_BY_VALUE = new Map<string, ApprovedBarWidth>(
  APPROVED_BAR_WIDTHS.map((width) => [String(width), width] as const),
);

const SETTING_PATCH_BUILDERS: Record<string, SettingPatchBuilder> = {
  display: displayPatchForValue,
  "color-scheme": colorSchemePatchForValue,
  "bar-style": barStylePatchForValue,
  "bar-width": barWidthPatchForValue,
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
    createChangeHandler(callbacks),
    callbacks.onCancel ?? (() => undefined),
  );
}

export function configPatchForInteractiveSetting(
  id: string,
  newValue: string,
): UsageConfigPatch | undefined {
  return SETTING_PATCH_BUILDERS[id]?.(newValue);
}

export function buildInteractiveSettingsRows(config: UsageConfig): SettingItem[] {
  return [
    {
      id: "display",
      label: "Display",
      currentValue: formatDisplayValue(config),
      values: [...DISPLAY_VALUES],
    },
    {
      id: "color-scheme",
      label: "Color scheme",
      currentValue: formatJsonOnlyCustomValue(config.colors.scheme),
      values: [...COLOR_SCHEME_PRESETS],
    },
    {
      id: "bar-style",
      label: "Bar style",
      currentValue: formatJsonOnlyCustomValue(config.bar.style),
      values: [...BAR_STYLE_PRESETS],
    },
    {
      id: "bar-width",
      label: "Bar width",
      currentValue: String(config.bar.width),
      values: [...BAR_WIDTH_VALUES],
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

function createChangeHandler(
  callbacks: InteractiveSettingsMenuCallbacks,
): (id: string, newValue: string) => void {
  return (id, newValue) => {
    callbacks.onChange?.(id, newValue);

    const patch = configPatchForInteractiveSetting(id, newValue);
    if (patch !== undefined) callbacks.onPatch?.(patch);
  };
}

function displayPatchForValue(value: string): UsageConfigPatch | undefined {
  if (!isDisplayValue(value)) return undefined;

  switch (value) {
    case "On":
      return { enabled: true, display: { showAlways: false } };
    case "Off":
      return { enabled: false, display: { showAlways: false } };
    case "Always":
      return { enabled: true, display: { showAlways: true } };
  }
}

function colorSchemePatchForValue(value: string): UsageConfigPatch | undefined {
  if (!isColorSchemePreset(value)) return undefined;
  return { colors: { scheme: value } };
}

function barStylePatchForValue(value: string): UsageConfigPatch | undefined {
  if (!isBarStylePreset(value)) return undefined;
  return { bar: { style: value } };
}

function barWidthPatchForValue(value: string): UsageConfigPatch | undefined {
  const width = BAR_WIDTH_BY_VALUE.get(value);
  if (width === undefined) return undefined;
  return { bar: { width } };
}

function isDisplayValue(value: string): value is DisplayValue {
  return includesString(DISPLAY_VALUES, value);
}

function isColorSchemePreset(value: string): value is ColorSchemePreset {
  return includesString(COLOR_SCHEME_PRESETS, value);
}

function isBarStylePreset(value: string): value is BarStylePreset {
  return includesString(BAR_STYLE_PRESETS, value);
}

function includesString<const T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value as T[number]);
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
