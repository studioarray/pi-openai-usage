import { describe, expect, it } from "vitest";

import { DEFAULT_USAGE_CONFIG, type UsageConfig, type UsageConfigPatch } from "../src/config";
import {
  buildInteractiveSettingsRows,
  configPatchForInteractiveSetting,
  createInteractiveSettingsMenu,
} from "../src/interactive-settings-menu";

function configWith(overrides: Partial<UsageConfig>): UsageConfig {
  return {
    ...DEFAULT_USAGE_CONFIG,
    ...overrides,
    display: {
      ...DEFAULT_USAGE_CONFIG.display,
      ...overrides.display,
    },
    widgets: {
      ...DEFAULT_USAGE_CONFIG.widgets,
      ...overrides.widgets,
    },
    bar: {
      ...DEFAULT_USAGE_CONFIG.bar,
      ...overrides.bar,
    },
    colors: {
      ...DEFAULT_USAGE_CONFIG.colors,
      ...overrides.colors,
    },
  };
}

describe("interactive settings menu", () => {
  it("exposes the approved values for display, color scheme, bar style, and bar width", () => {
    const rows = buildInteractiveSettingsRows(DEFAULT_USAGE_CONFIG);

    expect(rows.find((row) => row.id === "display")?.values).toEqual(["On", "Off", "Always"]);
    expect(rows.find((row) => row.id === "color-scheme")?.values).toEqual([
      "traffic",
      "cyan",
      "green",
      "mono",
      "none",
    ]);
    expect(rows.find((row) => row.id === "bar-style")?.values).toEqual([
      "blocks",
      "thin",
      "ascii",
      "dots",
      "squares",
      "braille",
    ]);
    expect(rows.find((row) => row.id === "bar-width")?.values).toEqual([
      "4",
      "6",
      "8",
      "10",
      "12",
      "16",
      "20",
    ]);
  });

  it("exposes the approved values for widget, reset, refresh interval, and label rows", () => {
    const rows = buildInteractiveSettingsRows(DEFAULT_USAGE_CONFIG);

    expect(rows.find((row) => row.id === "five-hour-display")?.values).toEqual([
      "hidden",
      "percent",
      "bar",
      "bar + percent",
    ]);
    expect(rows.find((row) => row.id === "seven-day-display")?.values).toEqual([
      "hidden",
      "percent",
      "bar",
      "bar + percent",
    ]);
    expect(rows.find((row) => row.id === "five-hour-reset-display")?.values).toEqual([
      "hidden",
      "countdown",
      "clock",
      "both",
    ]);
    expect(rows.find((row) => row.id === "seven-day-reset-display")?.values).toEqual([
      "hidden",
      "countdown",
      "clock",
      "both",
    ]);
    expect(rows.find((row) => row.id === "refresh-interval")?.values).toEqual([
      "15s",
      "30s",
      "1m",
      "2m",
      "5m",
      "10m",
    ]);
    expect(rows.find((row) => row.id === "hide-label")?.values).toEqual(["No", "Yes"]);
  });

  it("maps display, color scheme, bar style, and bar width selections to exact patches", () => {
    expect(configPatchForInteractiveSetting("display", "On")).toEqual({
      enabled: true,
      display: { showAlways: false },
    });
    expect(configPatchForInteractiveSetting("display", "Off")).toEqual({
      enabled: false,
      display: { showAlways: false },
    });
    expect(configPatchForInteractiveSetting("display", "Always")).toEqual({
      enabled: true,
      display: { showAlways: true },
    });

    for (const scheme of ["traffic", "cyan", "green", "mono", "none"] as const) {
      expect(configPatchForInteractiveSetting("color-scheme", scheme)).toEqual({
        colors: { scheme },
      });
    }
    for (const style of ["blocks", "thin", "ascii", "dots", "squares", "braille"] as const) {
      expect(configPatchForInteractiveSetting("bar-style", style)).toEqual({
        bar: { style },
      });
    }
    for (const width of [4, 6, 8, 10, 12, 16, 20] as const) {
      expect(configPatchForInteractiveSetting("bar-width", String(width))).toEqual({
        bar: { width },
      });
    }
  });

  it("maps widget, reset, refresh interval, and label selections to exact patches", () => {
    expect(configPatchForInteractiveSetting("five-hour-display", "hidden")).toEqual({
      widgets: { fiveHour: { enabled: false, mode: "hidden" } },
    });
    expect(configPatchForInteractiveSetting("five-hour-display", "percent")).toEqual({
      widgets: { fiveHour: { enabled: true, mode: "percent" } },
    });
    expect(configPatchForInteractiveSetting("five-hour-display", "bar")).toEqual({
      widgets: { fiveHour: { enabled: true, mode: "bar" } },
    });
    expect(configPatchForInteractiveSetting("five-hour-display", "bar + percent")).toEqual({
      widgets: { fiveHour: { enabled: true, mode: "bar-percent" } },
    });
    expect(configPatchForInteractiveSetting("seven-day-display", "bar + percent")).toEqual({
      widgets: { sevenDay: { enabled: true, mode: "bar-percent" } },
    });

    expect(configPatchForInteractiveSetting("five-hour-reset-display", "hidden")).toEqual({
      widgets: { fiveHourReset: { enabled: false, mode: "hidden" } },
    });
    expect(configPatchForInteractiveSetting("five-hour-reset-display", "countdown")).toEqual({
      widgets: { fiveHourReset: { enabled: true, mode: "countdown" } },
    });
    expect(configPatchForInteractiveSetting("five-hour-reset-display", "clock")).toEqual({
      widgets: { fiveHourReset: { enabled: true, mode: "clock" } },
    });
    expect(configPatchForInteractiveSetting("five-hour-reset-display", "both")).toEqual({
      widgets: { fiveHourReset: { enabled: true, mode: "both" } },
    });
    expect(configPatchForInteractiveSetting("seven-day-reset-display", "both")).toEqual({
      widgets: { sevenDayReset: { enabled: true, mode: "both" } },
    });

    expect(configPatchForInteractiveSetting("refresh-interval", "15s")).toEqual({
      refreshIntervalMs: 15_000,
    });
    expect(configPatchForInteractiveSetting("refresh-interval", "30s")).toEqual({
      refreshIntervalMs: 30_000,
    });
    expect(configPatchForInteractiveSetting("refresh-interval", "1m")).toEqual({
      refreshIntervalMs: 60_000,
    });
    expect(configPatchForInteractiveSetting("refresh-interval", "2m")).toEqual({
      refreshIntervalMs: 120_000,
    });
    expect(configPatchForInteractiveSetting("refresh-interval", "5m")).toEqual({
      refreshIntervalMs: 300_000,
    });
    expect(configPatchForInteractiveSetting("refresh-interval", "10m")).toEqual({
      refreshIntervalMs: 600_000,
    });

    expect(configPatchForInteractiveSetting("hide-label", "No")).toEqual({
      display: { showLabel: true },
    });
    expect(configPatchForInteractiveSetting("hide-label", "Yes")).toEqual({
      display: { showLabel: false },
    });
  });

  it("does not expose JSON-only custom color/bar states as selectable patches", () => {
    expect(configPatchForInteractiveSetting("color-scheme", "custom")).toBeUndefined();
    expect(configPatchForInteractiveSetting("color-scheme", "custom (JSON)")).toBeUndefined();
    expect(configPatchForInteractiveSetting("bar-style", "custom")).toBeUndefined();
    expect(configPatchForInteractiveSetting("bar-style", "custom (JSON)")).toBeUndefined();
  });

  it("emits preset patches when custom JSON color and bar selections change in the menu", () => {
    const colorPatches: UsageConfigPatch[] = [];
    const colorMenu = createInteractiveSettingsMenu(
      configWith({ colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "custom" } }),
      { onPatch: (patch) => colorPatches.push(patch) },
    );

    colorMenu.handleInput?.("\x1b[B");
    colorMenu.handleInput?.("\r");

    expect(colorPatches).toEqual([{ colors: { scheme: "traffic" } }]);

    const barPatches: UsageConfigPatch[] = [];
    const barMenu = createInteractiveSettingsMenu(
      configWith({ bar: { ...DEFAULT_USAGE_CONFIG.bar, style: "custom" } }),
      { onPatch: (patch) => barPatches.push(patch) },
    );

    barMenu.handleInput?.("\x1b[B");
    barMenu.handleInput?.("\x1b[B");
    barMenu.handleInput?.("\r");

    expect(barPatches).toEqual([{ bar: { style: "blocks" } }]);
  });

  it("renders current values for display and JSON-only custom color/bar states", () => {
    expect(
      buildInteractiveSettingsRows(configWith({ enabled: false })).find(
        (row) => row.id === "display",
      )?.currentValue,
    ).toBe("Off");
    expect(
      buildInteractiveSettingsRows(
        configWith({
          enabled: true,
          display: { ...DEFAULT_USAGE_CONFIG.display, showAlways: true },
        }),
      ).find((row) => row.id === "display")?.currentValue,
    ).toBe("Always");
    expect(
      buildInteractiveSettingsRows(configWith({ enabled: true })).find(
        (row) => row.id === "display",
      )?.currentValue,
    ).toBe("On");

    const rows = buildInteractiveSettingsRows(
      configWith({
        colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "custom" },
        bar: { ...DEFAULT_USAGE_CONFIG.bar, style: "custom" },
      }),
    );

    expect(rows.find((row) => row.id === "color-scheme")?.currentValue).toBe("custom (JSON)");
    expect(rows.find((row) => row.id === "bar-style")?.currentValue).toBe("custom (JSON)");
  });

  it("renders current values for widget, reset, refresh interval, and label rows", () => {
    const defaultRows = buildInteractiveSettingsRows(DEFAULT_USAGE_CONFIG);

    expect(defaultRows.find((row) => row.id === "five-hour-display")?.currentValue).toBe(
      "bar + percent",
    );
    expect(defaultRows.find((row) => row.id === "seven-day-display")?.currentValue).toBe(
      "bar + percent",
    );
    expect(defaultRows.find((row) => row.id === "five-hour-reset-display")?.currentValue).toBe(
      "countdown",
    );
    expect(defaultRows.find((row) => row.id === "seven-day-reset-display")?.currentValue).toBe(
      "countdown",
    );
    expect(defaultRows.find((row) => row.id === "refresh-interval")?.currentValue).toBe("1m");
    expect(defaultRows.find((row) => row.id === "hide-label")?.currentValue).toBe("No");

    const rows = buildInteractiveSettingsRows(
      configWith({
        refreshIntervalMs: 120_000,
        display: { ...DEFAULT_USAGE_CONFIG.display, showLabel: false },
        widgets: {
          ...DEFAULT_USAGE_CONFIG.widgets,
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, enabled: false, mode: "bar" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "percent" },
          fiveHourReset: {
            ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset,
            enabled: false,
            mode: "clock",
          },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, mode: "both" },
        },
      }),
    );

    expect(rows.find((row) => row.id === "five-hour-display")?.currentValue).toBe("hidden");
    expect(rows.find((row) => row.id === "seven-day-display")?.currentValue).toBe("percent");
    expect(rows.find((row) => row.id === "five-hour-reset-display")?.currentValue).toBe(
      "hidden",
    );
    expect(rows.find((row) => row.id === "seven-day-reset-display")?.currentValue).toBe("both");
    expect(rows.find((row) => row.id === "refresh-interval")?.currentValue).toBe("2m");
    expect(rows.find((row) => row.id === "hide-label")?.currentValue).toBe("Yes");
  });
});
