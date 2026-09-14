import { describe, expect, it } from "vitest";

import { parseUsageSnapshot } from "../src/usage-snapshot";

describe("usage snapshot parser", () => {
  it("classifies windows by duration into 5h and 7d remaining usage", () => {
    const snapshot = parseUsageSnapshot(
      {
        rate_limit: {
          allowed: false,
          primary_window: {
            limit_window_seconds: 18_000,
            used_percent: 12.5,
            reset_after_seconds: 60,
          },
          secondary_window: {
            limit_window_seconds: 604_800,
            used_percent: 150,
            reset_after_seconds: 3_600,
          },
        },
      },
      { nowMs: Date.UTC(2026, 0, 1) },
    );

    expect(snapshot).toEqual({
      fiveHourLeftPercent: 87.5,
      sevenDayLeftPercent: 0,
      fiveHourResetInSeconds: 60,
      sevenDayResetInSeconds: 3_600,
      isLimited: true,
    });
  });

  it("accepts reset_at seconds and milliseconds while preserving unavailable values", () => {
    const nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);

    expect(
      parseUsageSnapshot(
        {
          rate_limit: {
            limit_reached: true,
            primary_window: {
              limit_window_seconds: 18_000,
              used_percent: -25,
              reset_at: nowMs / 1000 + 120,
            },
            secondary_window: {
              limit_window_seconds: 604_800,
              reset_at: nowMs + 240_000,
            },
          },
        },
        { nowMs },
      ),
    ).toEqual({
      fiveHourLeftPercent: 100,
      sevenDayLeftPercent: null,
      fiveHourResetInSeconds: 120,
      sevenDayResetInSeconds: 240,
      isLimited: true,
    });

    expect(parseUsageSnapshot({}, { nowMs })).toEqual({
      fiveHourLeftPercent: null,
      sevenDayLeftPercent: null,
      fiveHourResetInSeconds: null,
      sevenDayResetInSeconds: null,
      isLimited: false,
    });
  });

  it("classifies a Pro/20x response with only a seven-day primary window", () => {
    const snapshot = parseUsageSnapshot({
      rate_limit: {
        allowed: true,
        primary_window: {
          limit_window_seconds: 604_800,
          used_percent: 25,
          reset_after_seconds: 86_400,
        },
      },
    });

    expect(snapshot).toEqual({
      fiveHourLeftPercent: null,
      sevenDayLeftPercent: 75,
      fiveHourResetInSeconds: null,
      sevenDayResetInSeconds: 86_400,
      isLimited: false,
    });
  });

  it("keeps the known Spark additional-rate-limit bucket parser-compatible", () => {
    const snapshot = parseUsageSnapshot(
      {
        rate_limit: {
          primary_window: {
            limit_window_seconds: 18_000,
            used_percent: 99,
            reset_after_seconds: 1,
          },
          secondary_window: {
            limit_window_seconds: 604_800,
            used_percent: 98,
            reset_after_seconds: 2,
          },
        },
        additional_rate_limits: {
          spark: {
            limit_name: "GPT-5.3-Codex-Spark",
            rate_limit: {
              primary_window: {
                limit_window_seconds: 18_000,
                used_percent: 40,
                reset_after_seconds: 300,
              },
              secondary_window: {
                limit_window_seconds: 604_800,
                used_percent: 30,
                reset_after_seconds: 600,
              },
            },
          },
        },
      },
      { modelId: "gpt-5.3-codex-spark" },
    );

    expect(snapshot).toMatchObject({
      fiveHourLeftPercent: 60,
      sevenDayLeftPercent: 70,
      fiveHourResetInSeconds: 300,
      sevenDayResetInSeconds: 600,
    });
  });
});
