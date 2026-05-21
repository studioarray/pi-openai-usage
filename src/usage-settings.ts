/**
 * Attribution:
 * Settings command structure and advanced JSON editor flow are adapted from usage-
 * specific patterns of the Reference Implementation (pi-better-openai), which is
 * MIT-licensed. The ported scope is intentionally limited to usage configuration,
 * diagnostics, and operational status for this extension.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  type BarStyleName,
  type ColorSchemeName,
  type ColorTarget,
  type ColorScaleMode,
  type CustomBarStyleConfig,
  type CustomColorConfig,
  type LoadedUsageConfig,
  type UsageConfig,
  type UsageConfigPatch,
  type UsageColor,
  type WindowWidgetMode,
  type ResetWidgetMode,
  type BarGradientDirection,
  type ColorStop,
  MAX_BAR_WIDTH,
  MAX_REFRESH_INTERVAL_MS,
  MIN_BAR_WIDTH,
  MIN_REFRESH_INTERVAL_MS,
  loadUsageConfig,
  patchUsageConfig,
} from "./config";
import { resolveCodexOAuthCredentials, type CodexCredentialResolution } from "./auth";
import { createUsageCommandFacade } from "./usage-command-facade";
import {
  createUsageRefreshCoordinator,
  type UsageRefreshCoordinator,
} from "./usage-refresh-coordinator";
import {
  fetchCodexUsage,
  type UsageClientPort,
  type UsageFetchError,
} from "./usage-client";
import { type UsageStateStore, createUsageStateStore } from "./usage-state";
import { formatDiagnosticsReport } from "./diagnostics-reporter";

type UsageSettingsCommandContext = Pick<
  ExtensionCommandContext,
  "ui" | "model" | "modelRegistry" | "signal" | "hasUI"
>;

type UsageSettingsCommandDependencies = {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: (
    ctx: UsageSettingsCommandContext,
  ) => Promise<CodexCredentialResolution>;
  usageClient?: UsageClientPort;
  usageState?: UsageStateStore;
  usageRefreshCoordinator?: UsageRefreshCoordinator;
  onConfigChanged?: (ctx: UsageSettingsCommandContext) => void | Promise<void>;
};

type OperationalHealth = {
  status: "ok" | "setup_required" | "auth_failed" | "refresh_failed";
  summary: string;
};

const defaultUsageClient: UsageClientPort = {
  fetchUsage: fetchCodexUsage,
};

export type { UsageSettingsCommandDependencies };

export function registerOpenAIUsageSettingsCommand(
  pi: ExtensionAPI,
  dependencies: UsageSettingsCommandDependencies = {},
): void {
  const loadConfig = dependencies.loadConfig ?? loadUsageConfig;
  const resolveCredentials = dependencies.resolveCredentials ?? defaultResolveCredentials;
  const usageClient = dependencies.usageClient ?? defaultUsageClient;
  const usageState = dependencies.usageState ?? createUsageStateStore();
  const usageRefreshCoordinator =
    dependencies.usageRefreshCoordinator ??
    createUsageRefreshCoordinator({ usageClient, usageState });
  const usageCommandFacade = createUsageCommandFacade({
    loadConfig,
    resolveCredentials: (ctx) => resolveCredentials(ctx as UsageSettingsCommandContext),
    usageRefreshCoordinator,
  });
  const onConfigChanged = dependencies.onConfigChanged;

  pi.registerCommand("openai-usage-settings", {
    description: "Show common usage settings and operational status",
    getArgumentCompletions(argumentPrefix: string) {
      return suggestSettingsSubcommands(argumentPrefix);
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();
      const commandContext = asUsageSettingsContext(ctx);

      if (trimmed.length === 0 || trimmed.toLowerCase() === "show") {
        await handleShowSettings({ commandContext, loadConfig, resolveCredentials, usageState });
        return;
      }

      const lowered = trimmed.toLowerCase();
      if (lowered === "usage") {
        await usageCommandFacade.showUsage(commandContext);
        return;
      }

      if (lowered === "refresh") {
        await usageCommandFacade.showUsage(commandContext, { forceRefresh: true });
        return;
      }

      if (lowered === "help") {
        notify(ctx, usageSettingsHelpText());
        return;
      }

      if (lowered === "diagnostics") {
        await handleDiagnostics({ commandContext, loadConfig, resolveCredentials, usageState });
        return;
      }

      if (lowered.startsWith("set ")) {
        const success = await handleSettingsSet({
          args: trimmed,
          commandContext,
          loadConfig,
          resolveCredentials,
          usageState,
          onConfigChanged,
        });
        if (!success) {
          notify(
            ctx,
            [
              "Invalid /openai-usage-settings usage.",
              usageSettingsHelpText(),
            ].join("\n"),
          );
        }
        return;
      }

      notify(ctx, "Unknown /openai-usage-settings subcommand. Use /openai-usage-settings help");
    },
  });
}

async function handleShowSettings(options: {
  commandContext: UsageSettingsCommandContext;
  loadConfig: () => LoadedUsageConfig;
  resolveCredentials: (ctx: UsageSettingsCommandContext) => Promise<CodexCredentialResolution>;
  usageState: UsageStateStore;
}): Promise<void> {
  const { commandContext, loadConfig, resolveCredentials, usageState } = options;
  const pickerAction = await selectSettingsPickerAction(commandContext);
  if (pickerAction === "help") {
    notify(commandContext, usageSettingsHelpText());
    return;
  }

  const loaded = loadConfig();
  const credentials = await resolveCredentials(commandContext);
  const health = resolveOperationalHealth(credentials, usageState);
  const lines = formatSettingsOutput(loaded.effective, health, usageState);
  notify(commandContext, lines.join("\n"));
}

async function selectSettingsPickerAction(
  commandContext: UsageSettingsCommandContext,
): Promise<"show" | "help"> {
  if (!commandContext.hasUI || typeof commandContext.ui.select !== "function") {
    return "show";
  }

  const choice = await commandContext.ui.select("openai-usage settings", [
    "Show settings",
    "Help",
  ]);

  if (choice === "Help") return "help";
  return "show";
}

async function handleDiagnostics(options: {
  commandContext: UsageSettingsCommandContext;
  loadConfig: () => LoadedUsageConfig;
  resolveCredentials: (ctx: UsageSettingsCommandContext) => Promise<CodexCredentialResolution>;
  usageState: UsageStateStore;
}): Promise<void> {
  const { commandContext, loadConfig, resolveCredentials, usageState } = options;
  const loaded = loadConfig();
  const credentials = await resolveCredentials(commandContext);
  notify(
    commandContext,
    formatDiagnosticsReport({
      loaded,
      credentials,
      usageState,
      runtime: commandContext,
    }),
  );
}

async function handleSettingsSet(options: {
  args: string;
  commandContext: UsageSettingsCommandContext;
  loadConfig: () => LoadedUsageConfig;
  resolveCredentials: (ctx: UsageSettingsCommandContext) => Promise<CodexCredentialResolution>;
  usageState: UsageStateStore;
  onConfigChanged?: (ctx: UsageSettingsCommandContext) => void | Promise<void>;
}): Promise<boolean> {
  const { args, commandContext, loadConfig, resolveCredentials, usageState, onConfigChanged } = options;

  const match = /^set\s+(\S+)\s+([\s\S]+)$/u.exec(args);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return false;
  }

  const key = match[1];
  const rawValue = match[2].trim();
  const loaded = loadConfig();

  const patch = parseSettingPatch(key, rawValue) ?? parseAdvancedSettingPatch(key, rawValue, loaded.effective);
  if (patch === undefined) {
    return false;
  }

  patchUsageConfig(loaded.configPath, patch);
  await onConfigChanged?.(commandContext);

  const updated = loadConfig();
  const credentials = await resolveCredentials(commandContext);
  const health = resolveOperationalHealth(credentials, usageState);
  const lines = [
    `Updated setting: ${key} = ${rawValue}`,
    "",
    ...formatSettingsOutput(updated.effective, health, usageState),
  ];
  notify(commandContext, lines.join("\n"));
  return true;
}

function parseSettingPatch(key: string, rawValue: string): UsageConfigPatch | undefined {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const valueText = stripQuotes(rawValue);

  if (normalized === "enabled") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { enabled: parsed };
  }

  if (normalized === "refreshintervalms" || normalized === "refreshinterval" || normalized === "intervalms") {
    const parsed = parseIntegerValue(valueText);
    if (parsed === undefined || parsed < MIN_REFRESH_INTERVAL_MS || parsed > MAX_REFRESH_INTERVAL_MS) {
      return undefined;
    }
    return { refreshIntervalMs: parsed };
  }

  if (normalized === "displayshowalways" || normalized === "showalways") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { display: { showAlways: parsed } };
  }

  if (normalized === "displayshowlabel" || normalized === "showlabel") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { display: { showLabel: parsed } };
  }

  if (normalized === "displaylabel" || normalized === "label") {
    return valueText.length === 0 ? undefined : { display: { label: valueText } };
  }

  if (normalized === "displayseparator" || normalized === "separator") {
    return valueText.length === 0 ? undefined : { display: { separator: valueText } };
  }

  if (normalized === "widgetsfivehourenabled") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { widgets: { fiveHour: { enabled: parsed } } };
  }

  if (normalized === "widgetsfivehourmode") {
    const parsed = parseWindowWidgetMode(valueText);
    return parsed === undefined ? undefined : { widgets: { fiveHour: { mode: parsed } } };
  }

  if (normalized === "widgetssevendayenabled") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { widgets: { sevenDay: { enabled: parsed } } };
  }

  if (normalized === "widgetssevendaymode") {
    const parsed = parseWindowWidgetMode(valueText);
    return parsed === undefined ? undefined : { widgets: { sevenDay: { mode: parsed } } };
  }

  if (normalized === "widgetsfivehourresetenabled") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { widgets: { fiveHourReset: { enabled: parsed } } };
  }

  if (normalized === "widgetsfivehourresetmode") {
    const parsed = parseResetWidgetMode(valueText);
    return parsed === undefined ? undefined : { widgets: { fiveHourReset: { mode: parsed } } };
  }

  if (normalized === "widgetssevendayresetenabled") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { widgets: { sevenDayReset: { enabled: parsed } } };
  }

  if (normalized === "widgetssevendayresetmode") {
    const parsed = parseResetWidgetMode(valueText);
    return parsed === undefined ? undefined : { widgets: { sevenDayReset: { mode: parsed } } };
  }

  if (normalized === "barstyle") {
    const parsed = parseBarStyle(valueText);
    return parsed === undefined ? undefined : { bar: { style: parsed } };
  }

  if (normalized === "barwidth") {
    const parsed = parseIntegerValue(valueText);
    return parsed === undefined ? undefined : { bar: { width: parsed } };
  }

  if (normalized === "barpartials") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { bar: { partials: parsed } };
  }

  if (normalized === "colorscheme") {
    const parsed = parseColorScheme(valueText);
    return parsed === undefined ? undefined : { colors: { scheme: parsed } };
  }

  if (normalized === "colortarget") {
    const parsed = parseColorTarget(valueText);
    return parsed === undefined ? undefined : { colors: { target: parsed } };
  }

  if (normalized === "colorsbargradientenabled") {
    const parsed = parseBooleanValue(valueText);
    return parsed === undefined ? undefined : { colors: { barGradient: { enabled: parsed } } };
  }

  if (normalized === "colorsbargradientdirection") {
    const parsed = parseBarGradientDirection(valueText);
    return parsed === undefined ? undefined : { colors: { barGradient: { direction: parsed } } };
  }

  return undefined;
}

function parseAdvancedSettingPatch(
  key: string,
  rawValue: string,
  config: UsageConfig,
): UsageConfigPatch | undefined {
  const normalized = normalizeSettingsKey(key);
  const parsed = parseJsonValue(rawValue);
  if (parsed === undefined) {
    return undefined;
  }

  if (normalized === "colorscustom" || normalized === "colorscustomstops") {
    const custom = parseCustomColorConfig(parsed, config.colors.custom.mode);
    if (custom === undefined) return undefined;
    return { colors: { custom } };
  }

  if (normalized === "barcustom") {
    const barCustom = parseBarStyleConfig(parsed);
    if (barCustom === undefined) return undefined;
    return { bar: { custom: barCustom } };
  }

  if (normalized === "config" || normalized === "fullconfig") {
    return parseFullConfigPatch(parsed, config);
  }

  return undefined;
}

function parseJsonValue(rawValue: string): unknown | undefined {
  const normalized = stripQuotes(rawValue);
  try {
    return JSON.parse(normalized);
  } catch {
    return undefined;
  }
}

function parseFullConfigPatch(
  raw: unknown,
  config: UsageConfig,
): UsageConfigPatch | undefined {
  const root = asRecord(raw);
  if (root === undefined) {
    return undefined;
  }

  const patch: UsageConfigPatch = {};
  let changed = false;

  if ("enabled" in root) {
    const parsed = parseBooleanFromUnknown(root.enabled);
    if (parsed === undefined) return undefined;
    patch.enabled = parsed;
    changed = true;
  }

  if ("refreshIntervalMs" in root) {
    const parsed = parseIntegerFromUnknown(root.refreshIntervalMs);
    if (parsed === undefined) return undefined;
    if (parsed < MIN_REFRESH_INTERVAL_MS || parsed > MAX_REFRESH_INTERVAL_MS) return undefined;
    patch.refreshIntervalMs = parsed;
    changed = true;
  }

  if ("display" in root) {
    const displayPatch = parseDisplayPatch(root.display);
    if (displayPatch === undefined) {
      return undefined;
    }
    if (Object.keys(displayPatch).length > 0) {
      patch.display = displayPatch;
      changed = true;
    }
  }

  if ("widgets" in root) {
    const widgetsPatch = parseWidgetsPatch(root.widgets);
    if (widgetsPatch === undefined) {
      return undefined;
    }
    if (Object.keys(widgetsPatch).length > 0) {
      patch.widgets = widgetsPatch;
      changed = true;
    }
  }

  if ("bar" in root) {
    const barPatch = parseBarPatch(root.bar);
    if (barPatch === undefined) {
      return undefined;
    }
    if (Object.keys(barPatch).length > 0) {
      patch.bar = barPatch;
      changed = true;
    }
  }

  if ("colors" in root) {
    const colorsPatch = parseColorsPatch(root.colors, config.colors.custom.mode);
    if (colorsPatch === undefined) {
      return undefined;
    }
    if (Object.keys(colorsPatch).length > 0) {
      patch.colors = colorsPatch;
      changed = true;
    }
  }

  return changed ? patch : undefined;
}

function parseDisplayPatch(raw: unknown): UsageConfigPatch["display"] | undefined {
  const display = asRecord(raw);
  if (display === undefined) {
    return undefined;
  }

  const patch: UsageConfigPatch["display"] = {};
  let changed = false;

  if ("showAlways" in display) {
    const parsed = parseBooleanFromUnknown(display.showAlways);
    if (parsed === undefined) return undefined;
    patch.showAlways = parsed;
    changed = true;
  }

  if ("showLabel" in display) {
    const parsed = parseBooleanFromUnknown(display.showLabel);
    if (parsed === undefined) return undefined;
    patch.showLabel = parsed;
    changed = true;
  }

  if ("label" in display) {
    if (!isNonEmptyString(display.label)) return undefined;
    patch.label = display.label.trim();
    changed = true;
  }

  if ("separator" in display) {
    if (typeof display.separator !== "string") return undefined;
    patch.separator = display.separator;
    changed = true;
  }

  return changed ? patch : undefined;
}

function parseWidgetsPatch(raw: unknown): UsageConfigPatch["widgets"] | undefined {
  const widgets = asRecord(raw);
  if (widgets === undefined) {
    return undefined;
  }

  let changed = false;
  const patch: UsageConfigPatch["widgets"] = {};

  const fiveHourPatch = parseWindowWidgetPatch(widgets.fiveHour);
  if (fiveHourPatch !== undefined) {
    patch.fiveHour = fiveHourPatch;
    changed = true;
  }

  const sevenDayPatch = parseWindowWidgetPatch(widgets.sevenDay);
  if (sevenDayPatch !== undefined) {
    patch.sevenDay = sevenDayPatch;
    changed = true;
  }

  const fiveHourResetPatch = parseResetWidgetPatch(widgets.fiveHourReset);
  if (fiveHourResetPatch !== undefined) {
    patch.fiveHourReset = fiveHourResetPatch;
    changed = true;
  }

  const sevenDayResetPatch = parseResetWidgetPatch(widgets.sevenDayReset);
  if (sevenDayResetPatch !== undefined) {
    patch.sevenDayReset = sevenDayResetPatch;
    changed = true;
  }

  if (!changed) {
    return undefined;
  }

  return patch;
}

function parseWindowWidgetPatch(
  raw: unknown,
): {
  enabled?: boolean;
  label?: string;
  mode?: WindowWidgetMode;
} | undefined {
  const widget = asRecord(raw);
  if (widget === undefined) {
    return undefined;
  }

  let changed = false;
  const patch: {
    enabled?: boolean;
    label?: string;
    mode?: WindowWidgetMode;
  } = {};

  if ("enabled" in widget) {
    const parsed = parseBooleanFromUnknown(widget.enabled);
    if (parsed === undefined) return undefined;
    patch.enabled = parsed;
    changed = true;
  }

  if ("label" in widget) {
    if (!isNonEmptyString(widget.label)) return undefined;
    patch.label = widget.label.trim();
    changed = true;
  }

  if ("mode" in widget) {
    if (typeof widget.mode !== "string") return undefined;
    const parsed = parseWindowWidgetMode(widget.mode);
    if (parsed === undefined) return undefined;
    patch.mode = parsed;
    changed = true;
  }

  return changed ? patch : undefined;
}

function parseResetWidgetPatch(
  raw: unknown,
): {
  enabled?: boolean;
  label?: string;
  mode?: ResetWidgetMode;
} | undefined {
  const widget = asRecord(raw);
  if (widget === undefined) {
    return undefined;
  }

  let changed = false;
  const patch: {
    enabled?: boolean;
    label?: string;
    mode?: ResetWidgetMode;
  } = {};

  if ("enabled" in widget) {
    const parsed = parseBooleanFromUnknown(widget.enabled);
    if (parsed === undefined) return undefined;
    patch.enabled = parsed;
    changed = true;
  }

  if ("label" in widget) {
    if (!isNonEmptyString(widget.label)) return undefined;
    patch.label = widget.label.trim();
    changed = true;
  }

  if ("mode" in widget) {
    if (typeof widget.mode !== "string") return undefined;
    const parsed = parseResetWidgetMode(widget.mode);
    if (parsed === undefined) return undefined;
    patch.mode = parsed;
    changed = true;
  }

  return changed ? patch : undefined;
}

function parseBarPatch(raw: unknown): UsageConfigPatch["bar"] | undefined {
  const bar = asRecord(raw);
  if (bar === undefined) {
    return undefined;
  }

  let changed = false;
  const patch: UsageConfigPatch["bar"] = {};

  if ("style" in bar) {
    if (typeof bar.style !== "string") return undefined;
    const parsed = parseBarStyle(bar.style);
    if (parsed === undefined) return undefined;
    patch.style = parsed;
    changed = true;
  }

  if ("width" in bar) {
    const parsed = parseIntegerFromUnknown(bar.width);
    if (parsed === undefined) return undefined;
    if (parsed < MIN_BAR_WIDTH || parsed > MAX_BAR_WIDTH) return undefined;
    patch.width = parsed;
    changed = true;
  }

  if ("partials" in bar) {
    const parsed = parseBooleanFromUnknown(bar.partials);
    if (parsed === undefined) return undefined;
    patch.partials = parsed;
    changed = true;
  }

  if ("custom" in bar) {
    const custom = parseBarStyleConfig(bar.custom);
    if (custom !== undefined) {
      patch.custom = custom;
      changed = true;
    } else if (bar.custom !== undefined) {
      return undefined;
    }
  }

  if (!changed) {
    return undefined;
  }

  return patch;
}

function parseColorsPatch(
  raw: unknown,
  defaultColorMode: ColorScaleMode,
): UsageConfigPatch["colors"] | undefined {
  const colors = asRecord(raw);
  if (colors === undefined) {
    return undefined;
  }

  let changed = false;
  const patch: UsageConfigPatch["colors"] = {};

  if ("scheme" in colors) {
    if (typeof colors.scheme !== "string") return undefined;
    const parsed = parseColorScheme(colors.scheme);
    if (parsed === undefined) return undefined;
    patch.scheme = parsed;
    changed = true;
  }

  if ("target" in colors) {
    if (typeof colors.target !== "string") return undefined;
    const parsed = parseColorTarget(colors.target);
    if (parsed === undefined) return undefined;
    patch.target = parsed;
    changed = true;
  }

  if ("barGradient" in colors) {
    const gradientPatch = parseBarGradientPatch(colors.barGradient);
    if (gradientPatch === undefined && colors.barGradient !== undefined) return undefined;
    if (gradientPatch !== undefined) {
      patch.barGradient = gradientPatch;
      changed = true;
    }
  }

  if ("custom" in colors) {
    const custom = parseCustomColorConfig(colors.custom, defaultColorMode);
    if (custom === undefined) {
      return undefined;
    }
    patch.custom = custom;
    changed = true;
  }

  if (!changed) {
    return undefined;
  }

  return patch;
}

function parseBarGradientPatch(
  raw: unknown,
): {
  enabled?: boolean;
  direction?: BarGradientDirection;
} | undefined {
  const gradient = asRecord(raw);
  if (gradient === undefined) {
    return undefined;
  }

  let changed = false;
  const patch: {
    enabled?: boolean;
    direction?: BarGradientDirection;
  } = {};

  if ("enabled" in gradient) {
    const parsed = parseBooleanFromUnknown(gradient.enabled);
    if (parsed === undefined) return undefined;
    patch.enabled = parsed;
    changed = true;
  }

  if ("direction" in gradient) {
    if (typeof gradient.direction !== "string") return undefined;
    const parsed = parseBarGradientDirection(gradient.direction);
    if (parsed === undefined) return undefined;
    patch.direction = parsed;
    changed = true;
  }

  return changed ? patch : undefined;
}

function parseBarStyleConfig(raw: unknown): CustomBarStyleConfig | undefined {
  const custom = asRecord(raw);
  if (custom === undefined) {
    return undefined;
  }

  let changed = false;
  const next: CustomBarStyleConfig = {} as CustomBarStyleConfig;

  if ("filled" in custom) {
    if (typeof custom.filled !== "string" || custom.filled.length === 0) return undefined;
    next.filled = custom.filled;
    changed = true;
  }

  if ("empty" in custom) {
    if (typeof custom.empty !== "string" || custom.empty.length === 0) return undefined;
    next.empty = custom.empty;
    changed = true;
  }

  if ("partials" in custom) {
    if (!Array.isArray(custom.partials)) return undefined;
    const partials: string[] = [];
    for (const partial of custom.partials) {
      if (typeof partial !== "string") return undefined;
      partials.push(partial);
    }
    if (partials.some((value) => value.length === 0)) return undefined;
    next.partials = partials;
    changed = true;
  }

  return changed ? next : undefined;
}

function parseCustomColorConfig(
  raw: unknown,
  defaultMode: ColorScaleMode,
): Partial<CustomColorConfig> | undefined {
  if (Array.isArray(raw)) {
    const stops = parseColorStops(raw, defaultMode);
    if (stops === undefined) return undefined;
    return {
      mode: defaultMode,
      stops,
    };
  }

  const custom = asRecord(raw);
  if (custom === undefined) {
    return undefined;
  }

  let mode: ColorScaleMode = defaultMode;
  let stops: ColorStop[] | undefined;
  let changed = false;

  if ("mode" in custom) {
    if (typeof custom.mode !== "string") return undefined;
    const parsed = parseColorScaleMode(custom.mode);
    if (parsed === undefined) return undefined;
    mode = parsed;
    changed = true;
  }

  if ("stops" in custom) {
    if (!Array.isArray(custom.stops)) return undefined;
    stops = parseColorStops(custom.stops, mode);
    if (stops === undefined) return undefined;
    changed = true;
  }

  if (!changed) return undefined;

  const patch: Partial<CustomColorConfig> = { mode };

  if (stops !== undefined) {
    patch.stops = stops;
  }

  return patch;
}

function parseColorStops(stops: readonly unknown[], mode: ColorScaleMode): ColorStop[] | undefined {
  const parsedStops: ColorStop[] = [];

  for (const stop of stops) {
    const parsed = parseColorStop(stop, mode);
    if (parsed === undefined) return undefined;
    parsedStops.push(parsed);
  }

  return parsedStops.sort((a, b) => b.percent - a.percent);
}

function parseColorStop(rawStop: unknown, mode: ColorScaleMode): ColorStop | undefined {
  const stop = asRecord(rawStop);
  if (stop === undefined) return undefined;

  const percent = parsePercentFromUnknown(stop.percent);
  if (percent === undefined) return undefined;

  const color = parseUsageColor(stop.color, mode);
  if (color === undefined) return undefined;

  const snapshot: ColorStop = {
    percent,
    color,
  };

  if (typeof stop.label === "string" && stop.label.trim().length > 0) {
    snapshot.label = stop.label.trim();
  }

  return snapshot;
}

function parseUsageColor(value: unknown, mode: ColorScaleMode): UsageColor | undefined {
  if (typeof value === "number") {
    return isFiniteIntegerInRange(value, 0, 255) ? value : undefined;
  }

  if (typeof value !== "string") return undefined;

  if (isPiThemeColorToken(value)) {
    if (mode === "step") {
      return value;
    }
    return undefined;
  }

  if (isHexColor(value)) {
    return value as UsageColor;
  }

  return undefined;
}

function parseBooleanFromUnknown(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function parseIntegerFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : undefined;
}

function parsePercentFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseColorScaleMode(value: string): ColorScaleMode | undefined {
  const candidate = value.toLowerCase();
  if (candidate === "step" || candidate === "gradient") {
    return candidate;
  }
  return undefined;
}

function normalizeSettingsKey(rawKey: string): string {
  return rawKey.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPiThemeColorToken(value: string): value is
  | "success"
  | "warning"
  | "error"
  | "muted"
  | "dim"
  | "text"
  | "accent" {
  return value === "success" || value === "warning" || value === "error" || value === "muted" || value === "dim" || value === "text" || value === "accent";
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/u.test(value);
}

function isFiniteIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function resolveOperationalHealth(
  credentials: CodexCredentialResolution,
  usageState: UsageStateStore,
): OperationalHealth {
  if (!credentials.ok) {
    return {
      status: "setup_required",
      summary: credentials.error.message,
    };
  }

  const currentError = usageState.getCurrentError();
  if (currentError === undefined) {
    return {
      status: "ok",
      summary: "OK",
    };
  }

  return {
    status: currentError.kind === "auth" ? "auth_failed" : "refresh_failed",
    summary:
      currentError.kind === "auth"
        ? `auth failed (${currentError.message})`
        : `refresh failed (${currentError.message})`,
  };
}

function formatSettingsOutput(
  config: UsageConfig,
  health: OperationalHealth,
  usageState: UsageStateStore,
): string[] {
  return [
    "openai-usage settings",
    "",
    "Operational status:",
    `  status: ${healthLabel(health)}`,
    `  detail: ${health.summary}`,
    `  last refreshed: ${formatDateTime(usageState.getLastSuccessAt())}`,
    `  last attempt: ${formatDateTime(usageState.getLastAttemptAt())}`,
    ...formatCurrentErrorLines(usageState.getCurrentError()),
    "",
    "Common settings:",
    `  enabled: ${formatBooleanText(config.enabled)}`,
    `  refreshIntervalMs: ${config.refreshIntervalMs}`,
    "  display.showAlways: " + formatBooleanText(config.display.showAlways),
    "  display.showLabel: " + formatBooleanText(config.display.showLabel),
    `  display.label: ${config.display.label}`,
    `  display.separator: ${JSON.stringify(config.display.separator)}`,
    "  widgets.fiveHour.enabled: " + formatBooleanText(config.widgets.fiveHour.enabled),
    `  widgets.fiveHour.mode: ${config.widgets.fiveHour.mode}`,
    "  widgets.sevenDay.enabled: " + formatBooleanText(config.widgets.sevenDay.enabled),
    `  widgets.sevenDay.mode: ${config.widgets.sevenDay.mode}`,
    "  widgets.fiveHourReset.enabled: " + formatBooleanText(config.widgets.fiveHourReset.enabled),
    `  widgets.fiveHourReset.mode: ${config.widgets.fiveHourReset.mode}`,
    "  widgets.sevenDayReset.enabled: " + formatBooleanText(config.widgets.sevenDayReset.enabled),
    `  widgets.sevenDayReset.mode: ${config.widgets.sevenDayReset.mode}`,
    `  bar.style: ${config.bar.style}`,
    `  bar.width: ${config.bar.width}`,
    `  bar.partials: ${formatBooleanText(config.bar.partials)}`,
    `  colors.scheme: ${config.colors.scheme}`,
    `  colors.target: ${config.colors.target}`,
    `  colors.barGradient.enabled: ${formatBooleanText(config.colors.barGradient.enabled)}`,
    `  colors.barGradient.direction: ${config.colors.barGradient.direction}`,
  ];
}

function formatCurrentErrorLines(error: UsageFetchError | undefined): string[] {
  if (error === undefined) {
    return ["  currentError: none"];
  }

  return [
    `  currentError: ${error.kind}${error.status === undefined ? "" : ` (${error.status})`}`,
    `  currentErrorMessage: ${error.message}`,
  ];
}

function healthLabel(health: OperationalHealth): string {
  switch (health.status) {
    case "ok":
      return "OK";
    case "setup_required":
      return "SETUP";
    case "auth_failed":
      return "AUTH_FAILED";
    case "refresh_failed":
      return "REFRESH_FAILED";
  }
}

function parseBooleanValue(value: string): boolean | undefined {
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "on", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "n"].includes(normalized)) return false;
  return undefined;
}

function parseIntegerValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^[-+]?\d+$/u.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseWindowWidgetMode(value: string): WindowWidgetMode | undefined {
  const candidate = value.toLowerCase();
  if (
    candidate === "percent" ||
    candidate === "bar" ||
    candidate === "bar-percent" ||
    candidate === "hidden"
  ) {
    return candidate;
  }

  return undefined;
}

function parseResetWidgetMode(value: string): ResetWidgetMode | undefined {
  const candidate = value.toLowerCase();
  if (
    candidate === "countdown" ||
    candidate === "clock" ||
    candidate === "both" ||
    candidate === "hidden"
  ) {
    return candidate;
  }

  return undefined;
}

function parseBarStyle(value: string): BarStyleName | undefined {
  const candidate = value.toLowerCase();
  if (
    candidate === "blocks" ||
    candidate === "thin" ||
    candidate === "ascii" ||
    candidate === "dots" ||
    candidate === "squares" ||
    candidate === "braille" ||
    candidate === "custom"
  ) {
    return candidate;
  }

  return undefined;
}

function parseColorScheme(value: string): ColorSchemeName | undefined {
  const candidate = value.toLowerCase();
  if (
    candidate === "traffic" ||
    candidate === "cyan" ||
    candidate === "green" ||
    candidate === "mono" ||
    candidate === "none" ||
    candidate === "custom"
  ) {
    return candidate;
  }

  return undefined;
}

function parseColorTarget(value: string): ColorTarget | undefined {
  const candidate = value.toLowerCase();
  if (
    candidate === "value" ||
    candidate === "widget" ||
    candidate === "bar" ||
    candidate === "percent" ||
    candidate === "none"
  ) {
    return candidate;
  }

  return undefined;
}

function parseBarGradientDirection(value: string): BarGradientDirection | undefined {
  const candidate = value.toLowerCase();
  if (candidate === "low-to-high" || candidate === "high-to-low") {
    return candidate;
  }

  return undefined;
}

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function formatDateTime(value: Date | undefined): string {
  return value === undefined ? "<none>" : value.toISOString();
}

function formatBooleanText(value: boolean): string {
  return value ? "yes" : "no";
}

function usageSettingsHelpText(): string {
  return [
    "/openai-usage-settings [subcommand]",
    "Available subcommands:",
    "  (none) Show common settings",
    "  set <key> <value>  Update a common setting",
    "  set <key> <json>  Update supported JSON settings (colors.custom, bar.custom, or config)",
    "  show    Show common settings and operational status",
    "  diagnostics    Show full diagnostics",
    "  help    Show this help",
    "",
    "Common keys:",
    "  enabled",
    "  refreshIntervalMs",
    "  display.showAlways",
    "  display.showLabel",
    "  display.label",
    "  display.separator",
    "  widgets.fiveHour.enabled, widgets.fiveHour.mode",
    "  widgets.sevenDay.enabled, widgets.sevenDay.mode",
    "  widgets.fiveHourReset.enabled, widgets.fiveHourReset.mode",
    "  widgets.sevenDayReset.enabled, widgets.sevenDayReset.mode",
    "  bar.style, bar.width, bar.partials",
    "  colors.scheme, colors.target, colors.barGradient.enabled, colors.barGradient.direction",
    "",
    "Advanced keys:",
    "  colors.custom",
    "    JSON object, e.g. { \"mode\": \"step\", \"stops\": [...] }",
    "  bar.custom",
    "    JSON object, e.g. { \"filled\": \"X\", \"empty\": \"_\", \"partials\": [\"+\"] }",
    "  config",
    "    JSON object for batched configuration updates",
  ].join("\n");
}

function suggestSettingsSubcommands(argumentPrefix: string) {
  const prefix = argumentPrefix.trim().toLowerCase();
  const commands = ["show", "set", "diagnostics", "help"];
  const matches = commands
    .filter((command) => command.startsWith(prefix))
    .map((command) => ({
      value: command,
      label: command,
    }));
  return matches.length > 0 ? matches : null;
}

function asUsageSettingsContext(ctx: ExtensionCommandContext): UsageSettingsCommandContext {
  return ctx as UsageSettingsCommandContext;
}

function notify(ctx: UsageSettingsCommandContext, message: string): void {
  ctx.ui.notify(message, "info");
}

function defaultResolveCredentials(
  ctx: UsageSettingsCommandContext,
): Promise<CodexCredentialResolution> {
  return resolveCodexOAuthCredentials({ modelRegistry: ctx.modelRegistry });
}
