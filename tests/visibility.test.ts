import { describe, expect, it, vi } from "vitest";

import { decideUsageVisibility } from "../src/visibility";

describe("usage visibility gate", () => {
  it("treats OpenAI and OpenAI Codex OAuth-backed models as eligible without model allow-listing", () => {
    const modelRegistry = {
      isUsingOAuth: vi.fn(() => true),
    };

    expect(
      decideUsageVisibility({
        showAlways: false,
        model: { provider: "openai", id: "any-openai-model" },
        modelRegistry,
      }),
    ).toEqual({ visible: true, reason: "eligible_model" });
    expect(
      decideUsageVisibility({
        showAlways: false,
        model: { provider: "openai-codex", id: "not-a-hardcoded-codex-id" },
        modelRegistry,
      }),
    ).toEqual({ visible: true, reason: "eligible_model" });
    expect(modelRegistry.isUsingOAuth).toHaveBeenCalledTimes(2);
  });

  it("treats non-OAuth or non-OpenAI models as ineligible when show always is false", () => {
    const modelRegistry = {
      isUsingOAuth: vi.fn(() => false),
    };

    expect(
      decideUsageVisibility({
        showAlways: false,
        model: { provider: "openai", id: "gpt-any" },
        modelRegistry,
      }),
    ).toEqual({ visible: false, reason: "ineligible_model" });
    expect(
      decideUsageVisibility({
        showAlways: false,
        model: { provider: "anthropic", id: "claude" },
        modelRegistry,
      }),
    ).toEqual({ visible: false, reason: "ineligible_model" });
    expect(modelRegistry.isUsingOAuth).toHaveBeenCalledTimes(1);
  });

  it("lets show always allow visibility without consulting the current provider credentials", () => {
    const modelRegistry = {
      isUsingOAuth: vi.fn(() => false),
    };

    expect(
      decideUsageVisibility({
        showAlways: true,
        model: { provider: "anthropic", id: "claude" },
        modelRegistry,
      }),
    ).toEqual({ visible: true, reason: "show_always" });
    expect(
      decideUsageVisibility({
        showAlways: true,
        model: undefined,
        modelRegistry,
      }),
    ).toEqual({ visible: true, reason: "show_always" });
    expect(modelRegistry.isUsingOAuth).not.toHaveBeenCalled();
  });
});
