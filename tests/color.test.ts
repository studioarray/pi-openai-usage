import { describe, expect, it, vi } from "vitest";

import { DEFAULT_USAGE_CONFIG, type ColorConfig } from "../src/config";
import { colorizeProgressBarSegments, colorizeUsageText } from "../src/color";

function colorConfig(overrides: Partial<ColorConfig> = {}): ColorConfig {
  return {
    ...DEFAULT_USAGE_CONFIG.colors,
    ...overrides,
    barGradient: {
      ...DEFAULT_USAGE_CONFIG.colors.barGradient,
      ...overrides.barGradient,
    },
    custom: {
      ...DEFAULT_USAGE_CONFIG.colors.custom,
      ...overrides.custom,
      stops:
        overrides.custom?.stops ?? DEFAULT_USAGE_CONFIG.colors.custom.stops.map((stop) => ({ ...stop })),
    },
  };
}

function fakeTheme(options: { name?: string; colorMode?: "truecolor" | "256color" } = {}) {
  return {
    name: options.name ?? "dark",
    fg: vi.fn((color: string, text: string) => `<${color}>${text}\x1b[39m`),
    getColorMode: vi.fn(() => options.colorMode ?? "truecolor"),
  };
}

describe("colorizeUsageText", () => {
  it("uses Pi theme tokens for traffic scheme colors", () => {
    const theme = fakeTheme();

    const text = colorizeUsageText({
      text: "88%",
      percent: 88,
      colors: colorConfig({ scheme: "traffic" }),
      theme,
    });

    expect(text).toBe("<success>88%\x1b[39m");
    expect(theme.fg).toHaveBeenCalledWith("success", "88%");
  });

  it("uses active theme name to choose light and dark built-in variants", () => {
    const dark = fakeTheme({ name: "dark", colorMode: "truecolor" });
    const light = fakeTheme({ name: "light", colorMode: "truecolor" });
    const colors = colorConfig({ scheme: "mono" });

    expect(colorizeUsageText({ text: "100%", percent: 100, colors, theme: dark })).toBe(
      "\x1b[38;2;248;250;252m100%\x1b[39m",
    );
    expect(colorizeUsageText({ text: "100%", percent: 100, colors, theme: light })).toBe(
      "\x1b[38;2;17;24;39m100%\x1b[39m",
    );
  });

  it("honors the supplied theme color mode for built-in hex schemes", () => {
    const theme = fakeTheme({ colorMode: "256color" });

    const text = colorizeUsageText({
      text: "100%",
      percent: 100,
      colors: colorConfig({ scheme: "cyan" }),
      theme,
    });

    expect(text).toMatch(/^\x1b\[38;5;\d+m100%\x1b\[39m$/u);
    expect(text).not.toContain("38;2");
    expect(text).not.toContain("\x1b[0m");
  });

  it("does not color unavailable values or scheme none", () => {
    const theme = fakeTheme();

    expect(
      colorizeUsageText({
        text: "--",
        percent: null,
        colors: colorConfig({ scheme: "traffic" }),
        theme,
      }),
    ).toBe("--");
    expect(
      colorizeUsageText({
        text: "88%",
        percent: 88,
        colors: colorConfig({ scheme: "none" }),
        theme,
      }),
    ).toBe("88%");
    expect(theme.fg).not.toHaveBeenCalled();
  });

  it("resets foreground color without emitting a full ANSI reset", () => {
    const theme = fakeTheme({ colorMode: "truecolor" });

    const text = colorizeUsageText({
      text: "50%",
      percent: 50,
      colors: colorConfig({ scheme: "green" }),
      theme,
    });

    expect(text).toContain("\x1b[39m");
    expect(text).not.toContain("\x1b[0m");
  });

  it("supports custom step stops with theme tokens, hex colors, and xterm indexes", () => {
    const theme = fakeTheme({ colorMode: "truecolor" });
    const colors = colorConfig({
      scheme: "custom",
      custom: {
        mode: "step",
        stops: [
          { percent: 80, color: "accent" },
          { percent: 50, color: "#112233" },
          { percent: 0, color: 196 },
        ],
      },
    });

    expect(colorizeUsageText({ text: "90%", percent: 90, colors, theme })).toBe(
      "<accent>90%\x1b[39m",
    );
    expect(colorizeUsageText({ text: "60%", percent: 60, colors, theme })).toBe(
      "\x1b[38;2;17;34;51m60%\x1b[39m",
    );
    expect(colorizeUsageText({ text: "10%", percent: 10, colors, theme })).toBe(
      "\x1b[38;5;196m10%\x1b[39m",
    );
  });

  it("supports custom gradient stops and honors truecolor versus 256-color mode", () => {
    const colors = colorConfig({
      scheme: "custom",
      custom: {
        mode: "gradient",
        stops: [
          { percent: 100, color: "#0000ff" },
          { percent: 0, color: 196 },
        ],
      },
    });

    expect(
      colorizeUsageText({
        text: "50%",
        percent: 50,
        colors,
        theme: fakeTheme({ colorMode: "truecolor" }),
      }),
    ).toBe("\x1b[38;2;128;0;128m50%\x1b[39m");

    const xtermText = colorizeUsageText({
      text: "50%",
      percent: 50,
      colors,
      theme: fakeTheme({ colorMode: "256color" }),
    });
    expect(xtermText).toMatch(/^\x1b\[38;5;\d+m50%\x1b\[39m$/u);
    expect(xtermText).not.toContain("38;2");
  });
});

describe("colorizeProgressBarSegments", () => {
  it("colors filled and partial progress-bar cells only", () => {
    const colors = colorConfig({
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
    });

    const text = colorizeProgressBarSegments({
      segments: [
        { text: "X", kind: "filled" },
        { text: "X", kind: "filled" },
        { text: "+", kind: "partial" },
        { text: "_", kind: "empty" },
      ],
      percent: 62.5,
      colors,
      theme: fakeTheme({ colorMode: "truecolor" }),
    });

    expect(text).toBe(
      "\x1b[38;2;255;0;0mX\x1b[39m" +
        "\x1b[38;2;170;85;0mX\x1b[39m" +
        "\x1b[38;2;85;170;0m+\x1b[39m" +
        "_",
    );
  });

  it("does not apply bar gradients when the target is percent or none", () => {
    const segments = [
      { text: "#", kind: "filled" as const },
      { text: "-", kind: "empty" as const },
    ];
    const gradient = {
      enabled: true,
      direction: "low-to-high" as const,
    };

    expect(
      colorizeProgressBarSegments({
        segments,
        percent: 50,
        colors: colorConfig({ target: "percent", barGradient: gradient }),
        theme: fakeTheme(),
      }),
    ).toBe("#-");
    expect(
      colorizeProgressBarSegments({
        segments,
        percent: 50,
        colors: colorConfig({ target: "none", barGradient: gradient }),
        theme: fakeTheme(),
      }),
    ).toBe("#-");
  });
});
