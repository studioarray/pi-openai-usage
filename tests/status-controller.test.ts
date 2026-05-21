import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import piOpenAIUsage from "../index";
import { resolveCodexOAuthCredentials, type CodexCredentialResolution } from "../src/auth";
import { DEFAULT_USAGE_CONFIG, type LoadedUsageConfig, type UsageConfig } from "../src/config";
import type { UsageClientPort, UsageFetchError, UsageFetchResult } from "../src/usage-client";
import { createUsageStateStore, type UsageStateStore } from "../src/usage-state";
import { createUsageRefreshCoordinator } from "../src/usage-refresh-coordinator";
import {
  registerUsageStatusController,
  type TimerApi,
  type UsageStatusControllerDependencies,
} from "../src/status-controller";

type RegisteredHandler = (event: { type: string }, ctx: FakeExtensionContext) => unknown;

type FakeModel = {
  provider: string;
  id: string;
};

type FakeUsageTheme = {
  name: string;
  fg: ReturnType<typeof vi.fn<(color: string, text: string) => string>>;
  getColorMode: ReturnType<typeof vi.fn<() => "truecolor" | "256color">>;
};

type FakeExtensionContext = {
  model?: FakeModel;
  modelRegistry: {
    isUsingOAuth: ReturnType<typeof vi.fn<(model: FakeModel) => boolean>>;
    getApiKeyForProvider: ReturnType<typeof vi.fn<(provider: string) => Promise<string | undefined>>>;
  };
  ui: {
    setStatus: ReturnType<typeof vi.fn>;
    setFooter: ReturnType<typeof vi.fn>;
    theme?: FakeUsageTheme;
  };
};

function fakeTheme(options: { name?: string; colorMode?: "truecolor" | "256color" } = {}): FakeUsageTheme {
  return {
    name: options.name ?? "dark",
    fg: vi.fn((color: string, text: string) => `<${color}>${text}\x1b[39m`),
    getColorMode: vi.fn(() => options.colorMode ?? "truecolor"),
  };
}

function themeWithMarker(name: string): FakeUsageTheme {
  return {
    name,
    fg: vi.fn((color: string, text: string) => `<${name}:${color}>${text}\x1b[39m`),
    getColorMode: vi.fn(() => "truecolor"),
  };
}

function loadedConfig(effective: UsageConfig): LoadedUsageConfig {
  return {
    configPath: "/tmp/project/.pi/extensions/pi-openai-usage.json",
    projectConfigPath: "/tmp/project/.pi/extensions/pi-openai-usage.json",
    globalConfigPath: "/tmp/home/.pi/agent/extensions/pi-openai-usage.json",
    projectConfigExists: true,
    globalConfigExists: false,
    raw: { project: {}, global: {} },
    effective,
  };
}

function rawUsageResponse(
  options: {
    fiveHourUsedPercent?: number;
    sevenDayUsedPercent?: number;
    fiveHourResetAfterSeconds?: number;
    sevenDayResetAfterSeconds?: number;
  } = {},
): unknown {
  return {
    rate_limit: {
      primary_window: {
        used_percent: options.fiveHourUsedPercent ?? 12,
        reset_after_seconds: options.fiveHourResetAfterSeconds ?? 300,
      },
      secondary_window: {
        used_percent: options.sevenDayUsedPercent ?? 44,
        reset_after_seconds: options.sevenDayResetAfterSeconds ?? 600,
      },
    },
  };
}

function successfulUsageFetchResult(raw: unknown = rawUsageResponse()): UsageFetchResult {
  return { ok: true, raw, status: 200 };
}

function failedUsageFetchResult(error: UsageFetchError): UsageFetchResult {
  return { ok: false, error };
}

function successfulCredentialResolution(): CodexCredentialResolution {
  return {
    ok: true,
    credentials: {
      accessToken: "test-codex-token",
      accountId: "acct-test",
      source: "registry",
      toJSON() {
        return { accessToken: "<redacted>", accountId: "…test", source: "registry" };
      },
    },
    diagnostics: {
      source: "registry",
      checkedSources: ["registry"],
      hasAccessToken: true,
      hasAccountId: true,
      accountId: "…test",
    },
    toJSON() {
      return { ok: true, credentials: this.credentials.toJSON(), diagnostics: this.diagnostics };
    },
  };
}

function createStatusControllerHarness(options?: {
  config?: UsageConfig;
  loadConfig?: () => LoadedUsageConfig;
  timerApi?: TimerApi;
  useDefaultExtension?: boolean;
  model?: FakeModel | null;
  usingOAuth?: boolean;
  resolveCredentials?: UsageStatusControllerDependencies["resolveCredentials"];
  usageClient?: UsageClientPort;
  usageState?: UsageStateStore;
  usageRefreshCoordinator?: UsageStatusControllerDependencies["usageRefreshCoordinator"];
  theme?: FakeUsageTheme;
}) {
  const handlers = new Map<string, RegisteredHandler[]>();
  const model =
    options?.model === null
      ? undefined
      : (options?.model ?? { provider: "openai", id: "any-openai-model" });
  const isUsingOAuth = vi.fn((_model: FakeModel) => options?.usingOAuth ?? true);
  const getApiKeyForProvider = vi.fn(async (_provider: string) => undefined);

  const pi = {
    on(eventName: string, handler: RegisteredHandler) {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);
    },
  } as unknown as ExtensionAPI;

  const ctx: FakeExtensionContext = {
    model,
    modelRegistry: {
      isUsingOAuth,
      getApiKeyForProvider,
    },
    ui: {
      setStatus: vi.fn(),
      setFooter: vi.fn(),
      theme: options?.theme,
    },
  };

  const usageClient =
    options?.usageClient ??
    ({ fetchUsage: vi.fn(async () => successfulUsageFetchResult()) } satisfies UsageClientPort);

  if (options?.useDefaultExtension) {
    piOpenAIUsage(pi);
  } else {
    registerUsageStatusController(pi, {
      loadConfig:
        options?.loadConfig ??
        (() => loadedConfig(options?.config ?? DEFAULT_USAGE_CONFIG)),
      timerApi: options?.timerApi,
      resolveCredentials:
        options?.resolveCredentials ?? (async () => successfulCredentialResolution()),
      usageClient,
      usageState: options?.usageState,
      usageRefreshCoordinator: options?.usageRefreshCoordinator,
    });
  }

  async function emit(eventName: string) {
    for (const handler of handlers.get(eventName) ?? []) {
      await handler({ type: eventName }, ctx);
    }
  }

  return { ctx, emit, handlers };
}

describe("usage status controller", () => {
  it("publishes one status-line entry under the openai-usage key on session start", async () => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "/definitely/missing";
    try {
      const harness = createStatusControllerHarness({ useDefaultExtension: true });

      await harness.emit("session_start");
      await harness.emit("session_shutdown");

      expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
        "openai-usage",
        "Usage login required",
      );
      const publishedText = harness.ctx.ui.setStatus.mock.calls[0]?.[1] as string;
      expect(publishedText.length).toBeGreaterThan(0);
      expect(publishedText).not.toMatch(/[\r\n\u2028\u2029]/u);
      expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  });

  it("clears the openai-usage status-line entry on session shutdown", async () => {
    const harness = createStatusControllerHarness();

    await harness.emit("session_shutdown");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", undefined);
    expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("aborts in-flight usage refresh requests on session shutdown", async () => {
    let capturedSignal: AbortSignal | undefined;
    const usageClient = {
      fetchUsage: vi.fn(async (_credentials, options) =>
        new Promise<UsageFetchResult>((resolve) => {
          const signal = options?.signal;
          capturedSignal = signal;
          const onAbort = () =>
            resolve({
              ok: false,
              error: { kind: "aborted", message: "Codex usage request was aborted" },
            });

          if (signal?.aborted) {
            onAbort();
            return;
          }

          signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ),
    } satisfies UsageClientPort;

    const baseCoordinator = createUsageRefreshCoordinator({ usageClient });
    const usageRefreshCoordinator = {
      refresh: vi.fn((options) => baseCoordinator.refresh(options)),
      isRefreshing: vi.fn(() => baseCoordinator.isRefreshing()),
      abortInFlightRefresh: vi.fn(() => baseCoordinator.abortInFlightRefresh()),
    };

    const harness = createStatusControllerHarness({
      usageClient,
      usageRefreshCoordinator,
    });

    const startSession = harness.emit("session_start");
    await Promise.resolve();

    await harness.emit("session_shutdown");

    expect(usageRefreshCoordinator.abortInFlightRefresh).toHaveBeenCalled();
    expect(capturedSignal?.aborted).toBe(true);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", undefined);

    await startSession;
  });

  it("reapplies status immediately when the settings command disables usage", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-openai-usage-settings-reapply-"));
    const project = join(root, "project");
    const previousCwd = process.cwd();
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const handlers = new Map<string, RegisteredHandler[]>();
    let settingsCommand: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;

    try {
      mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
      writeFileSync(
        join(project, ".pi", "extensions", "pi-openai-usage.json"),
        `${JSON.stringify({ ...DEFAULT_USAGE_CONFIG, enabled: true }, null, 2)}\n`,
        "utf8",
      );
      process.chdir(project);
      process.env.PI_CODING_AGENT_DIR = join(root, "missing-agent");

      const pi = {
        on(eventName: string, handler: RegisteredHandler) {
          const eventHandlers = handlers.get(eventName) ?? [];
          eventHandlers.push(handler);
          handlers.set(eventName, eventHandlers);
        },
        registerCommand(name: string, definition: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) {
          if (name === "openai-usage-settings") settingsCommand = definition.handler;
        },
      } as unknown as ExtensionAPI;

      const ctx = {
        model: { provider: "openai", id: "any-openai-model" },
        modelRegistry: {
          isUsingOAuth: vi.fn(() => true),
          getApiKeyForProvider: vi.fn(async () => undefined),
        },
        signal: undefined,
        ui: {
          notify: vi.fn(),
          setStatus: vi.fn(),
          setFooter: vi.fn(),
        },
      } as unknown as FakeExtensionContext & ExtensionCommandContext;

      piOpenAIUsage(pi);
      for (const handler of handlers.get("session_start") ?? []) {
        await handler({ type: "session_start" }, ctx);
      }
      expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", "Usage login required");

      await settingsCommand?.("set enabled false", ctx);

      expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", undefined);
    } finally {
      process.chdir(previousCwd);
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears the status entry and skips refresh timers when config is disabled", async () => {
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "unused" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      config: { ...DEFAULT_USAGE_CONFIG, enabled: false },
      timerApi,
    });

    await harness.emit("session_start");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", undefined);
    expect(timerApi.setInterval).not.toHaveBeenCalled();
    expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("starts one refresh timer when enabled and clears it on shutdown", async () => {
    const timerHandle = { id: "refresh" };
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => timerHandle),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      config: { ...DEFAULT_USAGE_CONFIG, refreshIntervalMs: 30_000 },
      timerApi,
    });

    await harness.emit("session_start");
    await harness.emit("session_shutdown");

    expect(timerApi.setInterval).toHaveBeenCalledTimes(1);
    expect(timerApi.setInterval).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(timerApi.clearInterval).toHaveBeenCalledWith(timerHandle);
    expect(harness.ctx.ui.setStatus).toHaveBeenNthCalledWith(
      1,
      "openai-usage",
      "Usage: 5h ████████▉░ 88% | 7d █████▋░░░░ 56% | 5h ↺ 5m | 7d ↺ 10m",
    );
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", undefined);
    expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("stops an existing refresh timer if a later session start reads disabled config", async () => {
    const timerHandle = { id: "refresh" };
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => timerHandle),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const loadConfig = vi
      .fn<() => LoadedUsageConfig>()
      .mockReturnValueOnce(loadedConfig(DEFAULT_USAGE_CONFIG))
      .mockReturnValueOnce(loadedConfig(DEFAULT_USAGE_CONFIG))
      .mockReturnValue(loadedConfig({ ...DEFAULT_USAGE_CONFIG, enabled: false }));
    const harness = createStatusControllerHarness({ loadConfig, timerApi });

    await harness.emit("session_start");
    await harness.emit("session_start");

    expect(timerApi.setInterval).toHaveBeenCalledTimes(1);
    expect(timerApi.clearInterval).toHaveBeenCalledWith(timerHandle);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", undefined);
  });

  it("clears status and skips refresh timers when show always is false and the model is ineligible", async () => {
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "unused" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      model: { provider: "anthropic", id: "claude-sonnet" },
      usingOAuth: false,
      timerApi,
    });

    await harness.emit("session_start");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", undefined);
    expect(timerApi.setInterval).not.toHaveBeenCalled();
    expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("requires OAuth-backed OpenAI models when show always is false", async () => {
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "unused" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      model: { provider: "openai", id: "gpt-any" },
      usingOAuth: false,
      timerApi,
    });

    await harness.emit("session_start");

    expect(harness.ctx.modelRegistry.isUsingOAuth).toHaveBeenCalledWith({
      provider: "openai",
      id: "gpt-any",
    });
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", undefined);
    expect(timerApi.setInterval).not.toHaveBeenCalled();
  });

  it("allows visibility for any current model when show always is true", async () => {
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "refresh" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      config: {
        ...DEFAULT_USAGE_CONFIG,
        display: { ...DEFAULT_USAGE_CONFIG.display, showAlways: true },
      },
      model: { provider: "anthropic", id: "claude-sonnet" },
      usingOAuth: false,
      timerApi,
    });

    await harness.emit("session_start");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage: 5h ████████▉░ 88% | 7d █████▋░░░░ 56% | 5h ↺ 5m | 7d ↺ 10m",
    );
    expect(timerApi.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(harness.ctx.modelRegistry.isUsingOAuth).not.toHaveBeenCalled();
    expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("fetches visible usage on session start and stores the parsed snapshot", async () => {
    const usageState = createUsageStateStore();
    const usageClient = {
      fetchUsage: vi.fn(async () =>
        successfulUsageFetchResult({
          rate_limit: {
            primary_window: { used_percent: 12, reset_after_seconds: 300 },
            secondary_window: { used_percent: 44, reset_after_seconds: 600 },
          },
        }),
      ),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({ usageClient, usageState });

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: expect.any(String), accountId: expect.any(String) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(usageState.getSnapshot()).toEqual({
      fiveHourLeftPercent: 88,
      sevenDayLeftPercent: 56,
      fiveHourResetInSeconds: 300,
      sevenDayResetInSeconds: 600,
      isLimited: false,
    });
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage: 5h ████████▉░ 88% | 7d █████▋░░░░ 56% | 5h ↺ 5m | 7d ↺ 10m",
    );
  });

  it("fetches usage when model selection changes to an eligible model", async () => {
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({
      model: { provider: "anthropic", id: "claude-sonnet" },
      usageClient,
    });

    await harness.emit("session_start");
    harness.ctx.model = { provider: "openai-codex", id: "gpt-codex" };
    await harness.emit("model_select");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(usageClient.fetchUsage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: expect.any(String), accountId: expect.any(String) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("allows a usage fetch with Show Always even when no model is selected", async () => {
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({
      config: {
        ...DEFAULT_USAGE_CONFIG,
        display: { ...DEFAULT_USAGE_CONFIG.display, showAlways: true },
      },
      model: null,
      usageClient,
    });

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.modelRegistry.isUsingOAuth).not.toHaveBeenCalled();
  });

  it("requires Codex OAuth credentials when show always makes a non-Codex model visible", async () => {
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "unused" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      config: {
        ...DEFAULT_USAGE_CONFIG,
        display: { ...DEFAULT_USAGE_CONFIG.display, showAlways: true },
      },
      model: { provider: "anthropic", id: "claude-sonnet" },
      usingOAuth: false,
      timerApi,
      resolveCredentials: async (ctx) =>
        resolveCodexOAuthCredentials({
          modelRegistry: ctx.modelRegistry,
          authFilePath: "/definitely/missing/auth.json",
        }),
    });
    harness.ctx.modelRegistry.getApiKeyForProvider.mockImplementation(async (provider) => {
      if (provider === "anthropic") return "current-provider-token-must-not-be-used";
      return undefined;
    });

    await harness.emit("session_start");

    expect(harness.ctx.modelRegistry.isUsingOAuth).not.toHaveBeenCalled();
    expect(harness.ctx.modelRegistry.getApiKeyForProvider).toHaveBeenCalledTimes(1);
    expect(harness.ctx.modelRegistry.getApiKeyForProvider).toHaveBeenCalledWith("openai-codex");
    expect(harness.ctx.modelRegistry.getApiKeyForProvider).not.toHaveBeenCalledWith("anthropic");
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", "Usage login required");
    expect(timerApi.setInterval).not.toHaveBeenCalled();
    expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("shows auth failure state and replaces cached widgets when refresh reports auth failure", async () => {
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(
      {
        fiveHourLeftPercent: 88,
        sevenDayLeftPercent: 56,
        fiveHourResetInSeconds: 300,
        sevenDayResetInSeconds: 600,
        isLimited: false,
      },
      new Date(Date.now() - 120_000),
    );

    const usageClient = {
      fetchUsage: vi.fn().mockResolvedValueOnce(
        failedUsageFetchResult({
          kind: "auth",
          status: 403,
          message: "Codex usage authentication failed",
        }),
      ),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({
      usageState,
      usageClient,
    });

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", "Usage auth failed");
  });

  it("renders Usage auth failed for 401 responses without exposing token/account details", async () => {
    const usageClient = {
      fetchUsage: vi
        .fn()
        .mockResolvedValueOnce(
          failedUsageFetchResult({
            kind: "auth",
            status: 401,
            message: "Codex usage authentication failed for token: secret-token account: acct-123",
          }),
        ),
    } satisfies UsageClientPort;

    const harness = createStatusControllerHarness({
      usageClient,
      resolveCredentials: async () => successfulCredentialResolution(),
    });

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", "Usage auth failed");
    const finalText = harness.ctx.ui.setStatus.mock.calls.at(-1)?.[1] as string;
    expect(finalText).not.toContain("secret-token");
    expect(finalText).not.toContain("acct-123");
  });

  it("renders Usage login required when credentials miss account ID", async () => {
    const harness = createStatusControllerHarness({
      resolveCredentials: async () => ({
        ok: false,
        error: {
          code: "missing_account_id",
          message: "Missing openai-codex Account ID. Run /login openai-codex.",
        },
        diagnostics: {
          source: "registry",
          checkedSources: ["registry"],
          hasAccessToken: true,
          hasAccountId: false,
        },
      }),
    });

    await harness.emit("session_start");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage login required",
    );
  });

  it("preserves cached usage and appends a textual refresh-failed marker on non-auth failure", async () => {
    const usageState = createUsageStateStore();
    usageState.storeSnapshot(
      {
        fiveHourLeftPercent: 88,
        sevenDayLeftPercent: 56,
        fiveHourResetInSeconds: 300,
        sevenDayResetInSeconds: 600,
        isLimited: false,
      },
      new Date(Date.now() - 120_000),
    );

    const usageClient = {
      fetchUsage: vi
        .fn()
        .mockResolvedValueOnce(
          failedUsageFetchResult({
            kind: "network",
            message: "network down: secret token should not be shown",
          }),
        ),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({
      usageState,
      usageClient,
    });

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage: 5h ████████▉░ 88% | 7d █████▋░░░░ 56% | 5h ↺ 5m | 7d ↺ 10m (refresh failed)",
    );
    const final = harness.ctx.ui.setStatus.mock.calls.at(-1)?.[1] as string;
    expect(final).toContain("refresh failed");
    expect(final).not.toContain("secret token");
  });

  it("replaces cached usage with a concrete refresh failure when there is no cached snapshot", async () => {
    const usageClient = {
      fetchUsage: vi
        .fn<UsageClientPort["fetchUsage"]>()
        .mockResolvedValueOnce(failedUsageFetchResult({ kind: "network", message: "timed out" })),
    } satisfies UsageClientPort;

    const harness = createStatusControllerHarness({
      usageClient,
    });

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", "Usage refresh failed");
  });

  it("publishes formatted cached usage using the effective display and widget config", async () => {
    const harness = createStatusControllerHarness({
      config: {
        ...DEFAULT_USAGE_CONFIG,
        display: { ...DEFAULT_USAGE_CONFIG.display, label: "OpenAI", separator: " / " },
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, mode: "hidden" },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, mode: "countdown" },
        },
      },
      usageClient: {
        fetchUsage: vi.fn(async () =>
          successfulUsageFetchResult(
            rawUsageResponse({
              fiveHourUsedPercent: 12,
              sevenDayUsedPercent: 44,
              fiveHourResetAfterSeconds: 300,
              sevenDayResetAfterSeconds: 600,
            }),
          ),
        ),
      },
    });

    await harness.emit("session_start");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "OpenAI: 5h: 88% / 7d ↺ 10m",
    );
  });

  it("passes the active UI theme into status formatting", async () => {
    const theme = fakeTheme();
    const harness = createStatusControllerHarness({
      theme,
      config: {
        ...DEFAULT_USAGE_CONFIG,
        widgets: {
          fiveHour: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHour, mode: "percent" },
          sevenDay: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDay, enabled: false },
          fiveHourReset: { ...DEFAULT_USAGE_CONFIG.widgets.fiveHourReset, enabled: false },
          sevenDayReset: { ...DEFAULT_USAGE_CONFIG.widgets.sevenDayReset, enabled: false },
        },
      },
    });

    await harness.emit("session_start");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage: 5h: <success>88%\x1b[39m",
    );
    expect(theme.fg).toHaveBeenCalledWith("success", "88%");
  });

  it("preserves cached usage while hidden and renders it immediately when visible again", async () => {
    let secondFetchResolve: ((result: UsageFetchResult) => void) | undefined;
    const secondFetch = new Promise<UsageFetchResult>((resolve) => {
      secondFetchResolve = resolve;
    });
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "refresh" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const usageClient = {
      fetchUsage: vi
        .fn<UsageClientPort["fetchUsage"]>()
        .mockResolvedValueOnce(successfulUsageFetchResult(rawUsageResponse({ fiveHourUsedPercent: 12 })))
        .mockImplementationOnce(async () => secondFetch),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({
      config: { ...DEFAULT_USAGE_CONFIG, refreshIntervalMs: 0 },
      timerApi,
      usageClient,
    });

    await harness.emit("session_start");
    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);

    harness.ctx.model = { provider: "anthropic", id: "claude-sonnet" };
    await harness.emit("model_select");

    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", undefined);
    expect(timerApi.clearInterval).toHaveBeenCalled();

    harness.ctx.model = { provider: "openai", id: "any-openai-model" };
    const visibilityTransition = harness.emit("model_select");
    harness.ctx.ui.setStatus.mockClear();

    await Promise.resolve();

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(2);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage: 5h ████████▉░ 88% | 7d █████▋░░░░ 56% | 5h ↺ 5m | 7d ↺ 10m",
    );
    expect(harness.ctx.ui.setStatus).not.toHaveBeenCalledWith("openai-usage", undefined);

    secondFetchResolve?.(successfulUsageFetchResult(rawUsageResponse({ fiveHourUsedPercent: 20 })));
    await visibilityTransition;
  });

  it("rerenders cached usage with updated config when refresh is skipped", async () => {
    const loadConfig = vi
      .fn<() => LoadedUsageConfig>()
      .mockReturnValueOnce(loadedConfig(DEFAULT_USAGE_CONFIG))
      .mockReturnValueOnce(
        loadedConfig({
          ...DEFAULT_USAGE_CONFIG,
          display: { ...DEFAULT_USAGE_CONFIG.display, label: "OpenAI", separator: " / " },
        }),
      )
      .mockReturnValue(
        loadedConfig({
          ...DEFAULT_USAGE_CONFIG,
          display: { ...DEFAULT_USAGE_CONFIG.display, label: "OpenAI", separator: " / " },
        }),
      );
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({ loadConfig, usageClient });

    await harness.emit("session_start");
    harness.ctx.ui.setStatus.mockClear();

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "openai-usage",
      "OpenAI: 5h ████████▉░ 88% / 7d █████▋░░░░ 56% / 5h ↺ 5m / 7d ↺ 10m",
    );
  });

  it("rerenders cached usage with updated config at turn end", async () => {
    const loadConfig = vi
      .fn<() => LoadedUsageConfig>()
      .mockReturnValueOnce(loadedConfig(DEFAULT_USAGE_CONFIG))
      .mockReturnValueOnce(
        loadedConfig({
          ...DEFAULT_USAGE_CONFIG,
          display: { ...DEFAULT_USAGE_CONFIG.display, label: "OpenAI", separator: " / " },
        }),
      )
      .mockReturnValue(
        loadedConfig({
          ...DEFAULT_USAGE_CONFIG,
          display: { ...DEFAULT_USAGE_CONFIG.display, label: "OpenAI", separator: " / " },
        }),
      );
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({ loadConfig, usageClient });

    await harness.emit("session_start");
    harness.ctx.ui.setStatus.mockClear();

    await harness.emit("turn_end");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "openai-usage",
      "OpenAI: 5h ████████▉░ 88% / 7d █████▋░░░░ 56% / 5h ↺ 5m / 7d ↺ 10m",
    );
  });

  it("keeps cached widgets visible while a stale turn-end refresh is in flight", async () => {
    let secondFetchResolve: ((result: UsageFetchResult) => void) | undefined;
    const secondFetch = new Promise<UsageFetchResult>((resolve) => {
      secondFetchResolve = resolve;
    });
    const usageClient = {
      fetchUsage: vi
        .fn<UsageClientPort["fetchUsage"]>()
        .mockResolvedValueOnce(successfulUsageFetchResult(rawUsageResponse({ fiveHourUsedPercent: 12 })))
        .mockImplementationOnce(async () => secondFetch),
    } satisfies UsageClientPort;
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "refresh" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      config: { ...DEFAULT_USAGE_CONFIG, refreshIntervalMs: 0 },
      timerApi,
      usageClient,
    });

    await harness.emit("session_start");
    harness.ctx.ui.setStatus.mockClear();

    const turnEnd = harness.emit("turn_end");
    await Promise.resolve();

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(2);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage: 5h ████████▉░ 88% | 7d █████▋░░░░ 56% | 5h ↺ 5m | 7d ↺ 10m",
    );
    expect(harness.ctx.ui.setStatus).not.toHaveBeenCalledWith("openai-usage", undefined);

    secondFetchResolve?.(successfulUsageFetchResult(rawUsageResponse({ fiveHourUsedPercent: 20 })));
    await turnEnd;
  });

  it("rerenders cached usage through a skipped refresh using the current UI theme", async () => {
    const darkTheme = themeWithMarker("dark");
    const lightTheme = themeWithMarker("light");
    const usageClient = {
      fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({
      theme: darkTheme,
      usageClient,
    });

    await harness.emit("session_start");

    harness.ctx.ui.theme = lightTheme;
    harness.ctx.ui.setStatus.mockClear();

    await harness.emit("session_start");

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "openai-usage",
      expect.stringContaining("<light:success>"),
    );
    expect(lightTheme.fg).toHaveBeenCalled();
  });

  it("clears the status entry when a visible refresh has no displayable usage values", async () => {
    const harness = createStatusControllerHarness({
      usageClient: {
        fetchUsage: vi.fn(async () => successfulUsageFetchResult({})),
      },
    });

    await harness.emit("session_start");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("openai-usage", undefined);
  });

  it("stops refresh activity and clears status when model selection becomes ineligible", async () => {
    const timerHandle = { id: "refresh" };
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => timerHandle),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({ timerApi });

    await harness.emit("session_start");
    harness.ctx.model = { provider: "anthropic", id: "claude-sonnet" };
    await harness.emit("model_select");

    expect(timerApi.setInterval).toHaveBeenCalledTimes(1);
    expect(timerApi.clearInterval).toHaveBeenCalledWith(timerHandle);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", undefined);
  });

  it("does not republish usage after a visible refresh becomes hidden while in flight", async () => {
    let resolveInFlight!: (result: UsageFetchResult) => void;
    const inFlightRefresh = new Promise<UsageFetchResult>((resolve) => {
      resolveInFlight = resolve;
    });
    const usageClient = {
      fetchUsage: vi.fn(async () => inFlightRefresh),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({ usageClient });

    const activeApply = harness.emit("session_start");
    await Promise.resolve();

    harness.ctx.model = { provider: "anthropic", id: "claude-sonnet" };
    await harness.emit("model_select");

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", undefined);

    resolveInFlight(successfulUsageFetchResult());
    await activeApply;

    expect(harness.ctx.ui.setStatus).toHaveBeenCalledTimes(1);
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("openai-usage", undefined);
  });

  it("does not call footer APIs while managing status", async () => {
    const timerApi = {
      setInterval: vi.fn((_handler: () => void, _delayMs: number): unknown => ({ id: "refresh" })),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    const harness = createStatusControllerHarness({
      timerApi,
      usageClient: {
        fetchUsage: vi.fn(async () => successfulUsageFetchResult()),
      },
    });

    await harness.emit("session_start");
    await harness.emit("model_select");
    await harness.emit("session_shutdown");

    expect(harness.ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("does not gate visibility by fast-mode model identifiers", async () => {
    const harness = createStatusControllerHarness({
      model: { provider: "openai", id: "pi-openai-fast" },
      usingOAuth: true,
    });

    await harness.emit("session_start");

    expect(harness.ctx.modelRegistry.isUsingOAuth).toHaveBeenCalledWith({
      provider: "openai",
      id: "pi-openai-fast",
    });
    const lastCall = harness.ctx.ui.setStatus.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("openai-usage");
    expect(lastCall?.[1]).toContain("Usage:");
  });

  it("keeps rendering cached widgets immediately while a timer refresh is in flight", async () => {
    let timerHandler: (() => void) | undefined;
    const timerApi = {
      setInterval: vi.fn((handler: () => void, _delayMs: number): unknown => {
        timerHandler = handler;
        return { id: "refresh" };
      }),
      clearInterval: vi.fn((_handle: unknown) => undefined),
    };
    let secondFetchResolve: ((result: UsageFetchResult) => void) | undefined;
    const secondFetch = new Promise<UsageFetchResult>((resolve) => {
      secondFetchResolve = resolve;
    });
    const usageClient = {
      fetchUsage: vi
        .fn<UsageClientPort["fetchUsage"]>()
        .mockResolvedValueOnce(successfulUsageFetchResult(rawUsageResponse({ fiveHourUsedPercent: 12 })))
        .mockImplementationOnce(async () => secondFetch),
    } satisfies UsageClientPort;
    const harness = createStatusControllerHarness({
      config: { ...DEFAULT_USAGE_CONFIG, refreshIntervalMs: 0 },
      timerApi,
      usageClient,
    });

    await harness.emit("session_start");
    harness.ctx.ui.setStatus.mockClear();

    timerHandler?.();
    timerHandler?.();
    await Promise.resolve();

    expect(usageClient.fetchUsage).toHaveBeenCalledTimes(2);
    expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith(
      "openai-usage",
      "Usage: 5h ████████▉░ 88% | 7d █████▋░░░░ 56% | 5h ↺ 5m | 7d ↺ 10m",
    );
    expect(harness.ctx.ui.setStatus).not.toHaveBeenCalledWith("openai-usage", undefined);

    secondFetchResolve?.(successfulUsageFetchResult(rawUsageResponse({ fiveHourUsedPercent: 20 })));
    await secondFetch;
    await Promise.resolve();
  });
});
