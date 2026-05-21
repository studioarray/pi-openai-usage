import { describe, expect, it } from "vitest";

import { DEFAULT_USAGE_CONFIG, type BarConfig } from "../src/config";
import { renderProgressBar, renderProgressBarSegments } from "../src/progress-bar";

function barConfig(overrides: Partial<BarConfig> = {}): BarConfig {
  return {
    ...DEFAULT_USAGE_CONFIG.bar,
    ...overrides,
    custom: {
      ...DEFAULT_USAGE_CONFIG.bar.custom,
      ...overrides.custom,
    },
  };
}

describe("renderProgressBar", () => {
  it("renders every built-in style at the configured width", () => {
    const styles = [
      ["blocks", "██░░"],
      ["thin", "━━──"],
      ["ascii", "##--"],
      ["dots", "●●○○"],
      ["squares", "■■□□"],
      ["braille", "⣿⣿⠀⠀"],
    ] as const;

    for (const [style, expected] of styles) {
      const bar = renderProgressBar(50, barConfig({ style, width: 4, partials: false }));

      expect(bar).toBe(expected);
      expect(Array.from(bar)).toHaveLength(4);
    }
  });

  it("uses partial cells when enabled and falls back to full cells when disabled", () => {
    const partialBar = renderProgressBar(88, barConfig({ style: "blocks", width: 10, partials: true }));
    const fullCellBar = renderProgressBar(88, barConfig({ style: "blocks", width: 10, partials: false }));

    expect(partialBar).toBe("████████▉░");
    expect(fullCellBar).toBe("█████████░");
    expect(Array.from(partialBar)).toHaveLength(10);
    expect(Array.from(fullCellBar)).toHaveLength(10);
  });

  it("renders custom bar styles including custom partial cells", () => {
    const custom = barConfig({
      style: "custom",
      width: 4,
      partials: true,
      custom: { filled: "X", empty: "_", partials: ["a", "b", "c"] },
    });

    expect(renderProgressBar(62.5, custom)).toBe("XXb_");
    expect(Array.from(renderProgressBar(62.5, custom))).toHaveLength(4);
  });

  it("falls back from custom bar glyphs that are not one display cell wide", () => {
    const custom = barConfig({
      style: "custom",
      width: 4,
      partials: true,
      custom: { filled: "🚀", empty: "界", partials: ["🚀", "+"] },
    });

    expect(renderProgressBar(62.5, custom)).toBe("▰▰+▱");
  });

  it("exposes pure cell segments for layered gradient coloring", () => {
    const custom = barConfig({
      style: "custom",
      width: 4,
      partials: true,
      custom: { filled: "X", empty: "_", partials: ["a", "b", "c"] },
    });

    expect(renderProgressBarSegments(62.5, custom)).toEqual([
      { text: "X", kind: "filled" },
      { text: "X", kind: "filled" },
      { text: "b", kind: "partial" },
      { text: "_", kind: "empty" },
    ]);
  });

  it("clamps percentages and renders unavailable values as an empty bar", () => {
    const config = barConfig({ style: "ascii", width: 4, partials: false });

    expect(renderProgressBar(-20, config)).toBe("----");
    expect(renderProgressBar(150, config)).toBe("####");
    expect(renderProgressBar(null, config)).toBe("----");
  });
});
