import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPROVED_BAR_WIDTHS,
  APPROVED_REFRESH_INTERVALS_MS,
  CONFIG_BASENAME,
  DEFAULT_USAGE_CONFIG,
  loadUsageConfig,
  patchUsageConfig,
} from "../src/config";

function createTempProject() {
  const root = mkdtempSync(join(tmpdir(), "pi-openai-usage-config-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, cwd, home };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("configuration store", () => {
  it("loads defaults and lets project config override global config", () => {
    const { root, cwd, home } = createTempProject();
    try {
      const globalPath = join(home, ".pi", "agent", "extensions", CONFIG_BASENAME);
      const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      writeJson(globalPath, {
        enabled: true,
        display: { label: "Global Usage", showAlways: false },
        bar: { width: 12 },
        colors: { target: "bar" },
      });
      writeJson(projectPath, {
        enabled: false,
        display: { showAlways: true },
        bar: { width: 16 },
      });

      const loaded = loadUsageConfig({ cwd, home });

      expect(loaded.configPath).toBe(projectPath);
      expect(loaded.globalConfigPath).toBe(globalPath);
      expect(loaded.projectConfigPath).toBe(projectPath);
      expect(loaded.effective.enabled).toBe(false);
      expect(loaded.effective.display.showAlways).toBe(true);
      expect(loaded.effective.display.label).toBe("Global Usage");
      expect(loaded.effective.display.separator).toBe(DEFAULT_USAGE_CONFIG.display.separator);
      expect(loaded.effective.widgets.fiveHour.mode).toBe(
        DEFAULT_USAGE_CONFIG.widgets.fiveHour.mode,
      );
      expect(loaded.effective.bar.width).toBe(16);
      expect(loaded.effective.colors.target).toBe("bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back safely for invalid values and invalid presets", () => {
    const { root, cwd, home } = createTempProject();
    try {
      const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      writeJson(projectPath, {
        enabled: "nope",
        refreshIntervalMs: 1,
        display: { showAlways: "yes", showLabel: "yes", label: "", separator: 42 },
        widgets: {
          fiveHour: { enabled: "yes", label: "", mode: "gauge" },
          sevenDayReset: { mode: "tomorrow" },
        },
        bar: {
          style: "emoji",
          width: Number.POSITIVE_INFINITY,
          partials: "sometimes",
          custom: { filled: "", empty: "", partials: ["", 7] },
        },
        colors: {
          scheme: "rainbow",
          target: "everything",
          custom: { mode: "gradient", stops: [{ percent: 50, color: "success" }] },
          barGradient: { enabled: "yes", direction: "sideways" },
        },
      });

      const { effective } = loadUsageConfig({ cwd, home });

      expect(effective.enabled).toBe(DEFAULT_USAGE_CONFIG.enabled);
      expect(effective.refreshIntervalMs).toBe(DEFAULT_USAGE_CONFIG.refreshIntervalMs);
      expect(effective.display).toEqual(DEFAULT_USAGE_CONFIG.display);
      expect(effective.widgets.fiveHour).toEqual(DEFAULT_USAGE_CONFIG.widgets.fiveHour);
      expect(effective.widgets.sevenDayReset).toEqual(DEFAULT_USAGE_CONFIG.widgets.sevenDayReset);
      expect(effective.bar.style).toBe(DEFAULT_USAGE_CONFIG.bar.style);
      expect(effective.bar.width).toBe(DEFAULT_USAGE_CONFIG.bar.width);
      expect(effective.bar.partials).toBe(DEFAULT_USAGE_CONFIG.bar.partials);
      expect(effective.bar.custom).toEqual(DEFAULT_USAGE_CONFIG.bar.custom);
      expect(effective.colors.scheme).toBe(DEFAULT_USAGE_CONFIG.colors.scheme);
      expect(effective.colors.target).toBe(DEFAULT_USAGE_CONFIG.colors.target);
      expect(effective.colors.custom).toEqual(DEFAULT_USAGE_CONFIG.colors.custom);
      expect(effective.colors.barGradient).toEqual(DEFAULT_USAGE_CONFIG.colors.barGradient);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes and sorts custom color stops", () => {
    const { root, cwd, home } = createTempProject();
    try {
      const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      writeJson(projectPath, {
        colors: {
          scheme: "custom",
          custom: {
            mode: "step",
            stops: [
              { percent: -10, color: "error", label: " low " },
              { percent: 70, color: "#65a30d" },
              { percent: "80", color: "success" },
              { percent: 50.4, color: 34, label: "xterm" },
              { percent: 20, color: "not-a-theme-token" },
              { percent: 120, color: "warning" },
            ],
          },
        },
      });

      const { effective } = loadUsageConfig({ cwd, home });

      expect(effective.colors.custom.stops).toEqual([
        { percent: 100, color: "warning" },
        { percent: 70, color: "#65a30d" },
        { percent: 50.4, color: 34, label: "xterm" },
        { percent: 0, color: "error", label: "low" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts custom gradient stops as hex colors or xterm indexes only", () => {
    const { root, cwd, home } = createTempProject();
    try {
      const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      writeJson(projectPath, {
        colors: {
          scheme: "custom",
          custom: {
            mode: "gradient",
            stops: [
              { percent: 100, color: "#00ff00" },
              { percent: 50, color: 34 },
              { percent: 0, color: "success" },
            ],
          },
        },
      });

      const { effective } = loadUsageConfig({ cwd, home });

      expect(effective.colors.custom.stops).toEqual([
        { percent: 100, color: "#00ff00" },
        { percent: 50, color: 34 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts every configured color scheme name including none and custom", () => {
    const schemes = ["traffic", "cyan", "green", "mono", "none", "custom"] as const;

    for (const scheme of schemes) {
      const { root, cwd, home } = createTempProject();
      try {
        const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
        writeJson(projectPath, { colors: { scheme } });

        const { effective } = loadUsageConfig({ cwd, home });

        expect(effective.colors.scheme).toBe(scheme);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("keeps JSON-only advanced display, widget, bar, and color states", () => {
    const { root, cwd, home } = createTempProject();
    try {
      const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      writeJson(projectPath, {
        display: { label: "Tokens", separator: " · " },
        widgets: {
          fiveHour: { label: "short", mode: "percent" },
          sevenDayReset: { label: "weekly reset", mode: "both" },
        },
        bar: {
          style: "custom",
          width: 20,
          partials: false,
          custom: { filled: "X", empty: "_", partials: ["a", "b"] },
        },
        colors: {
          scheme: "custom",
          target: "bar",
          barGradient: { enabled: true, direction: "high-to-low" },
          custom: {
            mode: "step",
            stops: [
              { percent: 100, color: "success" },
              { percent: 0, color: "error" },
            ],
          },
        },
      });

      const { effective } = loadUsageConfig({ cwd, home });

      expect(effective.display.label).toBe("Tokens");
      expect(effective.display.separator).toBe(" · ");
      expect(effective.widgets.fiveHour.label).toBe("short");
      expect(effective.widgets.fiveHour.mode).toBe("percent");
      expect(effective.widgets.sevenDayReset.label).toBe("weekly reset");
      expect(effective.widgets.sevenDayReset.mode).toBe("both");
      expect(effective.bar).toEqual({
        style: "custom",
        width: 20,
        partials: false,
        custom: { filled: "X", empty: "_", partials: ["a", "b"] },
      });
      expect(effective.colors).toEqual({
        scheme: "custom",
        target: "bar",
        barGradient: { enabled: true, direction: "high-to-low" },
        custom: {
          mode: "step",
          stops: [
            { percent: 100, color: "success" },
            { percent: 0, color: "error" },
          ],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only approved JSON bar widths", () => {
    expect(APPROVED_BAR_WIDTHS).toEqual([4, 6, 8, 10, 12, 16, 20]);

    for (const width of APPROVED_BAR_WIDTHS) {
      const { root, cwd, home } = createTempProject();
      try {
        const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
        writeJson(projectPath, { bar: { width } });

        const { effective } = loadUsageConfig({ cwd, home });

        expect(effective.bar.width).toBe(width);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("defaults arbitrary JSON bar widths instead of clamping them", () => {
    for (const width of [3, 5, 15, 999]) {
      const { root, cwd, home } = createTempProject();
      try {
        const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
        writeJson(projectPath, { bar: { width } });

        const { effective } = loadUsageConfig({ cwd, home });

        expect(effective.bar.width).toBe(DEFAULT_USAGE_CONFIG.bar.width);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("accepts only approved JSON refresh intervals", () => {
    expect(APPROVED_REFRESH_INTERVALS_MS).toEqual([
      15_000,
      30_000,
      60_000,
      120_000,
      300_000,
      600_000,
    ]);

    for (const refreshIntervalMs of APPROVED_REFRESH_INTERVALS_MS) {
      const { root, cwd, home } = createTempProject();
      try {
        const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
        writeJson(projectPath, { refreshIntervalMs });

        const { effective } = loadUsageConfig({ cwd, home });

        expect(effective.refreshIntervalMs).toBe(refreshIntervalMs);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("defaults arbitrary JSON refresh intervals instead of clamping them", () => {
    for (const refreshIntervalMs of [1, 45_000, 90_000, 900_000]) {
      const { root, cwd, home } = createTempProject();
      try {
        const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
        writeJson(projectPath, { refreshIntervalMs });

        const { effective } = loadUsageConfig({ cwd, home });

        expect(effective.refreshIntervalMs).toBe(DEFAULT_USAGE_CONFIG.refreshIntervalMs);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("validates custom bar styles and bar-gradient settings safely", () => {
    const { root, cwd, home } = createTempProject();
    try {
      const projectPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      writeJson(projectPath, {
        bar: {
          style: "custom",
          width: 999,
          custom: { filled: "", empty: "□", partials: ["◐", "", 2, "◑"] },
        },
        colors: {
          barGradient: { enabled: true, direction: "sideways" },
        },
      });

      const { effective } = loadUsageConfig({ cwd, home });

      expect(effective.bar.style).toBe("custom");
      expect(effective.bar.width).toBe(DEFAULT_USAGE_CONFIG.bar.width);
      expect(effective.bar.custom).toEqual({
        filled: DEFAULT_USAGE_CONFIG.bar.custom.filled,
        empty: "□",
        partials: ["◐", "◑"],
      });
      expect(effective.colors.barGradient).toEqual({
        enabled: true,
        direction: DEFAULT_USAGE_CONFIG.colors.barGradient.direction,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts display, color, and bar menu patches without discarding JSON-only custom payloads", () => {
    const { root, cwd } = createTempProject();
    try {
      const configPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      const customColor = {
        mode: "step",
        stops: [
          { percent: 100, color: "success" },
          { percent: 0, color: "error" },
        ],
      };
      const customBar = { filled: "X", empty: "_", partials: ["a", "b"] };
      writeJson(configPath, {
        enabled: false,
        display: { showAlways: true, label: "Tokens" },
        colors: { scheme: "custom", custom: customColor },
        bar: { style: "custom", width: 20, custom: customBar },
      });

      patchUsageConfig(configPath, {
        enabled: true,
        display: { showAlways: false },
        colors: { scheme: "cyan" },
        bar: { style: "dots", width: 12 },
      });

      expect(readJson(configPath)).toEqual({
        enabled: true,
        display: { showAlways: false, label: "Tokens" },
        colors: { scheme: "cyan", custom: customColor },
        bar: { style: "dots", width: 12, custom: customBar },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("patches known config fields without discarding unknown fields", () => {
    const { root, cwd } = createTempProject();
    try {
      const configPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
      writeJson(configPath, {
        enabled: true,
        futureTopLevel: { keep: true },
        display: { label: "Before", futureDisplayField: 42 },
        colors: {
          scheme: "traffic",
          futureColorsField: "keep",
          barGradient: { enabled: false, futureGradientField: "keep" },
        },
      });

      patchUsageConfig(configPath, {
        enabled: false,
        display: { showAlways: true },
        colors: { barGradient: { enabled: true } },
      });

      const written = readJson(configPath);
      expect(written.enabled).toBe(false);
      expect(written.futureTopLevel).toEqual({ keep: true });
      expect(written.display).toEqual({
        label: "Before",
        showAlways: true,
        futureDisplayField: 42,
      });
      expect(written.colors).toEqual({
        scheme: "traffic",
        futureColorsField: "keep",
        barGradient: { enabled: true, futureGradientField: "keep" },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
