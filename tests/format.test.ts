import { describe, expect, it, vi } from "vitest";

import { DEFAULT_USAGE_CONFIG, type UsageConfig } from "../src/config";
import {
  appendUsageRefreshFailureMarker,
  formatUsageAuthFailedStatusLine,
  formatUsageRefreshFailedStatusLine,
  formatUsageStatusLine,
} from "../src/format";
import type { UsageSnapshot } from "../src/usage-snapshot";

const SNAPSHOT: UsageSnapshot = {
  fiveHourLeftPercent: 88,
  sevenDayLeftPercent: 73,
  fiveHourResetInSeconds: 42 * 60,
  sevenDayResetInSeconds: 2 * 86_400 + 4 * 3_600,
  isLimited: false,
};

const UNAVAILABLE_SNAPSHOT: UsageSnapshot = {
  fiveHourLeftPercent: null,
  sevenDayLeftPercent: null,
  fiveHourResetInSeconds: null,
  sevenDayResetInSeconds: null,
  isLimited: false,
};

function fakeTheme(options: { name?: string; colorMode?: "truecolor" | "256color" } = {}) {
  return {
    name: options.name ?? "dark",
    fg: vi.fn((color: string, text: string) => `<${color}>${text}\x1b[39m`),
    getColorMode: vi.fn(() => options.colorMode ?? "truecolor"),
  };
}

function usageConfig(overrides: Partial<UsageConfig> = {}): UsageConfig {
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
      custom: {
        ...DEFAULT_USAGE_CONFIG.bar.custom,
        ...overrides.bar?.custom,
      },
    },
    colors: {
      ...DEFAULT_USAGE_CONFIG.colors,
      ...overrides.colors,
      barGradient: {
        ...DEFAULT_USAGE_CONFIG.colors.barGradient,
        ...overrides.colors?.barGradient,
      },
      custom: {
        ...DEFAULT_USAGE_CONFIG.colors.custom,
        ...overrides.colors?.custom,
        stops:
          overrides.colors?.custom?.stops ?? DEFAULT_USAGE_CONFIG.colors.custom.stops.map((stop) => ({ ...stop })),
      },
    },
  };
}

describe("formatUsageStatusLine", () => {
  it("formats the configured label, separator, window percentages, and reset countdowns", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        display: { ...DEFAULT_USAGE_CONFIG.display, label: "OpenAI", separator: " ~ " },
        widgets: {
          ...DEFAULT_USAGE_CONFIG.widgets,
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "percent" },
        },
      }),
    });

    expect(text).toBe("OpenAI: 5h: 88% ~ 7d: 73% ~ 5h ↺ 42m ~ 7d ↺ 2d4h");
    expect(text).not.toMatch(/[\r\n\u2028\u2029]/u);
  });

  it("can hide the status label while keeping configured widgets", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        display: { ...DEFAULT_USAGE_CONFIG.display, showLabel: false },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
    });

    expect(text).toBe("5h: 88%");
  });

  it("supports percent, bar, and bar-percent window widget modes", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "bar" },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, mode: "hidden" },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
    });

    expect(text).toBe("Usage: 5h: 88% | 7d ███████▍░░");
  });

  it("renders bar-percent widgets with custom progress bar configuration", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        bar: { ...DEFAULT_USAGE_CONFIG.bar, style: "ascii", width: 5, partials: false },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "bar-percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
    });

    expect(text).toBe("Usage: 5h ####- 88%");
  });

  it("omits each widget independently when it is disabled or hidden", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, enabled: false },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "hidden" },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, mode: "hidden" },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, mode: "countdown" },
        },
      }),
    });

    expect(text).toBe("Usage: 7d ↺ 2d4h");
  });

  it("supports clock and combined reset modes using the local clock formatter", () => {
    const text = formatUsageStatusLine({
      snapshot: {
        ...SNAPSHOT,
        fiveHourResetInSeconds: 60 * 60,
        sevenDayResetInSeconds: 25 * 60 * 60,
      },
      config: usageConfig({
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "hidden" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "hidden" },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, mode: "clock" },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, mode: "both" },
        },
      }),
      now: new Date("2026-01-01T00:00:00Z"),
      locale: "en-US",
      timeZone: "UTC",
    });

    expect(text).toBe("Usage: 5h ↺ 1:00 AM | 7d ↺ 1d1h - 1:00 AM");
  });

  it("clears when every configured widget is hidden", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "hidden" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "hidden" },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
    });

    expect(text).toBeUndefined();
  });

  it("clears when all visible widget values are unavailable", () => {
    const text = formatUsageStatusLine({
      snapshot: UNAVAILABLE_SNAPSHOT,
      config: usageConfig(),
    });

    expect(text).toBeUndefined();
  });

  it("renders unavailable values safely when another widget has displayable usage", () => {
    const text = formatUsageStatusLine({
      snapshot: {
        ...UNAVAILABLE_SNAPSHOT,
        fiveHourLeftPercent: 88,
      },
      config: usageConfig({
        widgets: {
          ...DEFAULT_USAGE_CONFIG.widgets,
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "percent" },
        },
      }),
    });

    expect(text).toBe("Usage: 5h: 88% | 7d: -- | 5h ↺ -- | 7d ↺ --");
  });

  it("renders unavailable bar values safely when another widget has displayable usage", () => {
    const text = formatUsageStatusLine({
      snapshot: {
        ...UNAVAILABLE_SNAPSHOT,
        sevenDayLeftPercent: 73,
      },
      config: usageConfig({
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "bar" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "percent" },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, mode: "hidden" },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
    });

    expect(text).toBe("Usage: 5h ░░░░░░░░░░ | 7d: 73%");
  });

  it("colors window values from the injected theme while leaving reset widgets neutral", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "traffic", target: "value" },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, mode: "countdown" },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
      theme: fakeTheme(),
    });

    expect(text).toBe("Usage: 5h: <success>88%\x1b[39m | 5h ↺ 42m");
  });

  it("colors only window widgets for widget target so reset widgets stay neutral", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "traffic", target: "widget" },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, mode: "countdown" },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
      theme: fakeTheme(),
    });

    expect(text).toBe("Usage: <success>5h: 88%\x1b[39m | 5h ↺ 42m");
  });

  it("routes bar and percent color targets to only those window-widget spans", () => {
    const baseWidgets = {
      fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "bar-percent" as const },
      sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
      fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
      sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
    };
    const baseBar = { ...DEFAULT_USAGE_CONFIG.bar, style: "ascii" as const, width: 4, partials: false };

    expect(
      formatUsageStatusLine({
        snapshot: SNAPSHOT,
        config: usageConfig({
          bar: baseBar,
          colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "traffic", target: "bar" },
          widgets: baseWidgets,
        }),
        theme: fakeTheme(),
      }),
    ).toBe("Usage: 5h <success>####\x1b[39m 88%");

    expect(
      formatUsageStatusLine({
        snapshot: SNAPSHOT,
        config: usageConfig({
          bar: baseBar,
          colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "traffic", target: "percent" },
          widgets: baseWidgets,
        }),
        theme: fakeTheme(),
      }),
    ).toBe("Usage: 5h #### <success>88%\x1b[39m");
  });

  it("keeps target value on bar-percent widgets away from the label", () => {
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        bar: { ...DEFAULT_USAGE_CONFIG.bar, style: "ascii", width: 4, partials: false },
        colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "traffic", target: "value" },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "bar-percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
      theme: fakeTheme(),
    });

    expect(text).toBe("Usage: 5h <success>#### 88%\x1b[39m");
  });

  it("applies bar gradients only to filled and partial cells in bar window widgets", () => {
    const text = formatUsageStatusLine({
      snapshot: { ...SNAPSHOT, fiveHourLeftPercent: 62.5 },
      config: usageConfig({
        bar: {
          ...DEFAULT_USAGE_CONFIG.bar,
          style: "custom",
          width: 4,
          partials: true,
          custom: { filled: "X", empty: "_", partials: ["+"] },
        },
        colors: {
          ...DEFAULT_USAGE_CONFIG.colors,
          scheme: "custom",
          target: "bar",
          barGradient: { enabled: true, direction: "low-to-high" },
          custom: {
            mode: "gradient",
            stops: [
              { percent: 100, color: "#00ff00" },
              { percent: 0, color: "#ff0000" },
            ],
          },
        },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "bar-percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
      theme: fakeTheme({ colorMode: "truecolor" }),
    });

    expect(text).toBe(
      "Usage: 5h " +
        "\x1b[38;2;255;0;0mX\x1b[39m" +
        "\x1b[38;2;170;85;0mX\x1b[39m" +
        "\x1b[38;2;85;170;0m+\x1b[39m" +
        "_ 63%",
    );
  });

  it("suppresses normal colors and bar gradients when target is none", () => {
    const theme = fakeTheme();
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        bar: { ...DEFAULT_USAGE_CONFIG.bar, style: "ascii", width: 4, partials: false },
        colors: {
          ...DEFAULT_USAGE_CONFIG.colors,
          scheme: "traffic",
          target: "none",
          barGradient: { enabled: true, direction: "low-to-high" },
        },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "bar-percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
      theme,
    });

    expect(text).toBe("Usage: 5h #### 88%");
    expect(theme.fg).not.toHaveBeenCalled();
  });

  it("leaves formatter output uncolored when the color scheme is none", () => {
    const theme = fakeTheme();
    const text = formatUsageStatusLine({
      snapshot: SNAPSHOT,
      config: usageConfig({
        colors: { ...DEFAULT_USAGE_CONFIG.colors, scheme: "none", target: "value" },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      }),
      theme,
    });

    expect(text).toBe("Usage: 5h: 88%");
    expect(theme.fg).not.toHaveBeenCalled();
  });

  it("formats auth failure, refresh failure, and refresh-failed marker states", () => {
    expect(formatUsageAuthFailedStatusLine()).toBe("Usage auth failed");
    expect(formatUsageRefreshFailedStatusLine()).toBe("Usage refresh failed");
    expect(appendUsageRefreshFailureMarker("Usage: 88% left")).toBe("Usage: 88% left (refresh failed)");
  });

  it("appends a plain textual refresh-failed marker that remains readable without color", () => {
    expect(appendUsageRefreshFailureMarker("Usage: 88% left")).toBe("Usage: 88% left (refresh failed)");
    expect(appendUsageRefreshFailureMarker("Usage: <success>88%\x1b[39m")).toBe(
      "Usage: <success>88%\x1b[39m (refresh failed)",
    );
  });

  it("colors the refresh-failed marker as a warning when a theme is available", () => {
    expect(appendUsageRefreshFailureMarker("Usage: 88% left", fakeTheme())).toBe(
      "Usage: 88% left (<warning>refresh failed\x1b[39m)",
    );
  });
});
