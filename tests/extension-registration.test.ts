import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import piOpenAIUsage from "../index";

describe("extension command registration", () => {
  it("keeps status registration active when command APIs are unavailable", () => {
    const registeredEvents: string[] = [];
    const pi = {
      on: vi.fn((eventName: string) => {
        registeredEvents.push(eventName);
      }),
    } as unknown as ExtensionAPI;

    expect(() => piOpenAIUsage(pi)).not.toThrow();

    expect(registeredEvents).toContain("session_start");
    expect(registeredEvents).toContain("session_shutdown");
  });

  it("registers only the one public usage/settings command", () => {
    const registeredCommands: string[] = [];
    const pi = {
      on: vi.fn(),
      registerCommand: vi.fn((name: string) => {
        registeredCommands.push(name);
      }),
    } as unknown as ExtensionAPI;

    piOpenAIUsage(pi);

    expect(registeredCommands).toEqual(["openai-usage-settings"]);
  });
});
