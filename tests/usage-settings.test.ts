import { join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  CONFIG_BASENAME,
  DEFAULT_USAGE_CONFIG,
  type LoadedUsageConfig,
  type UsageConfig,
  loadUsageConfig,
} from "../src/config";
import {
  registerOpenAIUsageSettingsCommand,
  type UsageSettingsCommandDependencies,
} from "../src/usage-settings";
import { parseUsageSnapshot } from "../src/usage-snapshot";
import { createUsageStateStore, type UsageStateStore } from "../src/usage-state";
import type { CodexCredentialResolution } from "../src/auth";

type RegisteredCommand = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

type SettingsHarness = {
  command: RegisteredCommand;
  ctx: ExtensionCommandContext;
  usageState: UsageStateStore;
};

function successfulCredentialResolution(): CodexCredentialResolution {
  return {
    ok: true,
    credentials: {
      accessToken: "test-codex-token",
      accountId: "acct-test-1234",
      source: "registry",
      toJSON() {
        return { accessToken: "<redacted>", accountId: "acct-…", source: "registry" };
      },
    },
    diagnostics: {
      source: "registry",
      checkedSources: ["registry"],
      hasAccessToken: true,
      hasAccountId: true,
      accountId: "acct-…",
    },
    toJSON() {
      return {
        ok: true,
        credentials: { accessToken: "<redacted>", accountId: "acct-…", source: "registry" },
        diagnostics: {
          source: "registry",
          checkedSources: ["registry"],
          hasAccessToken: true,
          hasAccountId: true,
          accountId: "acct-…",
        },
      };
    },
  };
}

function failedCredentialResolution(): CodexCredentialResolution {
  return {
    ok: false,
    error: {
      code: "missing_credentials",
      message: "Missing openai-codex OAuth credentials. Run /login openai-codex.",
    },
    diagnostics: {
      source: "none",
      checkedSources: ["registry", "auth_file"],
      hasAccessToken: false,
      hasAccountId: false,
    },
  };
}

function buildLoadedConfig(effective: UsageConfig): LoadedUsageConfig {
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

function createSettingsHarness(options: {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: () => Promise<CodexCredentialResolution>;
  usageState?: UsageStateStore;
  hasUI?: boolean;
  select?: ReturnType<typeof vi.fn<(title: string, options: string[]) => Promise<string | undefined>>>;
} = {}): SettingsHarness {
  let command: RegisteredCommand | undefined;

  const pi = {
    registerCommand: vi.fn((name: string, definition: { handler: RegisteredCommand }) => {
      if (name === "openai-usage-settings") {
        command = definition.handler;
      }
    }),
  } as unknown as ExtensionAPI;

  const usageState = options.usageState ?? createUsageStateStore();
  const dep: UsageSettingsCommandDependencies = {
    loadConfig: options.loadConfig ?? (() => buildLoadedConfig(DEFAULT_USAGE_CONFIG)),
    resolveCredentials: options.resolveCredentials
      ? async () => options.resolveCredentials!()
      : async () => successfulCredentialResolution(),
    usageState,
  };

  registerOpenAIUsageSettingsCommand(pi, dep);

  const ctx = {
    hasUI: options.hasUI ?? false,
    ui: {
      notify: vi.fn(),
      ...(options.select === undefined ? {} : { select: options.select }),
    },
    model: { provider: "openai", id: "any-openai-model" },
    signal: undefined,
    modelRegistry: {
      isUsingOAuth: vi.fn(() => true),
      getApiKeyForProvider: vi.fn(async () => "access-token"),
    },
  } as unknown as ExtensionCommandContext;

  return {
    command: command ?? (async () => {
      throw new Error("Command handler not registered");
    }),
    ctx,
    usageState,
  };
}

function lastNotifyText(ctx: ExtensionCommandContext): string {
  const calls = vi.mocked(ctx.ui.notify).mock.calls;
  const last = calls.at(-1) as [string, string?] | undefined;
  return last?.[0] ?? "";
}

function createTempProject() {
  const root = mkdtempSync(join(tmpdir(), "pi-openai-usage-settings-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, cwd, home };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("usage settings command", () => {
  it("shows healthy operational status and common settings", async () => {
    const usageState = createUsageStateStore();
    const now = new Date("2024-01-01T12:00:00.000Z");
    usageState.storeSnapshot(
      parseUsageSnapshot({
        rate_limit: {
          primary_window: { used_percent: 13, reset_after_seconds: 100 },
          secondary_window: { used_percent: 27, reset_after_seconds: 1_000 },
        },
      }),
      now,
    );

    const { command, ctx } = createSettingsHarness({
      usageState,
    });

    await command("", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("openai-usage settings");
    expect(text).toContain("status: OK");
    expect(text).toContain("last refreshed: 2024-01-01T12:00:00.000Z");
    expect(text).toContain("enabled: yes");
    expect(text).toContain("display.showAlways");
    expect(text).toContain("display.showLabel");
    expect(text).toContain("display.label");
    expect(text).toContain("display.separator");
    expect(text).toContain("widgets.fiveHour.mode:");
    expect(text).toContain("bar.style:");
    expect(text).toContain("colors.scheme:");
    expect(text).toContain("Diagnostics:");
    expect(text).toContain("Config path:");
  });

  it("opens a minimal interactive settings picker when UI selection is available", async () => {
    const select = vi.fn(async () => "Diagnostics");
    const { command, ctx } = createSettingsHarness({ hasUI: true, select });

    await command("", ctx);

    expect(select).toHaveBeenCalledWith(
      "openai-usage settings",
      expect.arrayContaining(["Show settings", "Diagnostics", "Help"]),
    );
    expect(lastNotifyText(ctx)).toContain("openai-usage diagnostics");
  });

  it("help text does not expose fast-mode controls", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("help", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("/openai-usage-settings");
    expect(text).toContain("Available subcommands:");
    expect(text).not.toContain("fast");
    expect(text).not.toContain("service_tier");
    expect(text).not.toContain("pi-openai-fast");
  });

  it("does not accept fast-mode setting keys", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("set fast-mode true", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");
  });

  it("reports setup-required status when auth is missing", async () => {
    const { command, ctx } = createSettingsHarness({
      resolveCredentials: async () => failedCredentialResolution(),
    });

    await command("", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("status: SETUP");
    expect(text).toContain("/login openai-codex");
    expect(text).toContain("Auth source: none");
    expect(text).toContain("Checked auth sources:");
  });

  it("updates a common setting and preserves unknown config fields", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const homeConfigPath = join(home, ".pi", "agent", "extensions", CONFIG_BASENAME);

    const initialProjectConfig = {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        keep: true,
      },
      display: {
        ...DEFAULT_USAGE_CONFIG.display,
        label: "before-change",
      },
    };
    writeJson(projectConfigPath, initialProjectConfig);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command("set bar.width 15", ctx);
    const updatedText = lastNotifyText(ctx);
    expect(updatedText).toContain('Updated setting: bar.width = 15');
    expect(updatedText).toContain('bar.width: 15');

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect((persisted.experimental as { keep?: unknown }).keep).toBe(true);
    expect((persisted as { bar?: { width?: unknown } }).bar?.width).toBe(15);
    expect((persisted as { display?: { label?: unknown } }).display?.label).toBe("before-change");

    rmSync(root, { recursive: true, force: true });
    rmSync(homeConfigPath, { recursive: true, force: true });
  });

  it("shows refresh-failed operational status when current error exists", async () => {
    const usageState = createUsageStateStore();
    usageState.recordFetchAttempt(new Date("2024-01-01T12:05:00.000Z"));
    usageState.recordFetchError({ kind: "network", message: "temporary outage", status: 503 });

    const { command, ctx } = createSettingsHarness({
      usageState,
    });

    await command("show", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("status: REFRESH_FAILED");
    expect(text).toContain("currentError: network (503)");
    expect(text).toContain("currentErrorMessage: temporary outage");
  });

  it("supports advanced JSON editing for colors.custom", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        note: "keep",
      },
    });

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    const json = `[{"percent": 99, "color": "#123456", "label": "high"}, {"percent": 0, "color": "error"}]`;
    await command(`set colors.custom "${json}"`, ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain(`Updated setting: colors.custom = "${json}"`);

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    const custom = (persisted as { colors?: { custom?: { mode?: string; stops?: unknown[] } } }).colors?.custom;
    expect(custom?.mode).toBe("step");
    expect(custom?.stops).toEqual([
      { percent: 99, color: "#123456", label: "high" },
      { percent: 0, color: "error" },
    ]);
    expect((persisted as { experimental?: { note?: unknown } }).experimental?.note).toBe("keep");

    rmSync(root, { recursive: true, force: true });
  });

  it("preserves existing custom color stops when updating only colors.custom mode", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    const initialCustomStops = [
      { percent: 99, color: "#123456", label: "high" },
      { percent: 0, color: 255 },
    ];

    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      colors: {
        ...DEFAULT_USAGE_CONFIG.colors,
        custom: {
          mode: "step",
          stops: initialCustomStops,
        },
      },
    });

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command('set colors.custom \'{"mode":"gradient"}\'', ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain('Updated setting: colors.custom = \'{"mode":"gradient"}\'');

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    const custom = (persisted as { colors?: { custom?: { mode?: string; stops?: unknown[] } } }).colors?.custom;
    expect(custom?.mode).toBe("gradient");
    expect(custom?.stops).toEqual(initialCustomStops);

    rmSync(root, { recursive: true, force: true });
  });

  it("supports advanced JSON editing for bar.custom", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    writeJson(projectConfigPath, DEFAULT_USAGE_CONFIG);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    const json = '{"filled": "█", "empty": "-", "partials": ["+"]}';
    await command(`set bar.custom '${json}'`, ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Updated setting: bar.custom = '" + json + "'");

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    const custom = (persisted as { bar?: { custom?: { filled?: string; empty?: string; partials?: string[] } } }).bar?.custom;
    expect(custom?.filled).toBe("█");
    expect(custom?.empty).toBe("-");
    expect(custom?.partials).toEqual(["+"]);

    rmSync(root, { recursive: true, force: true });
  });

  it("supports full JSON config editing and rejects invalid values", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);

    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        keep: true,
      },
      colors: {
        ...DEFAULT_USAGE_CONFIG.colors,
        custom: {
          mode: "step",
          stops: DEFAULT_USAGE_CONFIG.colors.custom.stops,
        },
      },
    });

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    const valid = '{"enabled":false,"bar":{"width":20,"custom":{"filled":"#","empty":"."},"style":"ascii"},"colors":{"custom":{"mode":"gradient","stops":[{"percent":100,"color":"#111111"},{"percent":0,"color":"#222222"}]}}}';
    await command(`set config ${valid}`, ctx);

    let text = lastNotifyText(ctx);
    expect(text).toContain("Updated setting: config = " + valid);

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect((persisted as { enabled?: boolean }).enabled).toBe(false);
    expect((persisted as { bar?: { width?: number } }).bar?.width).toBe(20);
    expect((persisted as { bar?: { custom?: { filled?: string } } }).bar?.custom?.filled).toBe("#");
    expect((persisted as { experimental?: { keep?: unknown } }).experimental?.keep).toBe(true);

    await command("set config {\"refreshIntervalMs\": 1}", ctx);
    text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");

    rmSync(root, { recursive: true, force: true });
  });

  it("diagnostics include raw config snapshots and config paths", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    writeJson(projectConfigPath, {
      ...DEFAULT_USAGE_CONFIG,
      diagnostic: "test",
    });

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command("diagnostics", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("openai-usage diagnostics");
    expect(text).toContain("Raw project config:");
    expect(text).toContain('"diagnostic": "test"');
    expect(text).toContain(`Config path: ${projectConfigPath}`);

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects invalid advanced JSON payloads", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const original = {
      ...DEFAULT_USAGE_CONFIG,
      experimental: {
        keep: true,
      },
    };
    writeJson(projectConfigPath, original);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command('set config {"enabled": true', ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect(persisted).toEqual(original);

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects invalid advanced JSON values without applying partial changes", async () => {
    const { cwd, home, root } = createTempProject();
    const projectConfigPath = join(cwd, ".pi", "extensions", CONFIG_BASENAME);
    const original = {
      ...DEFAULT_USAGE_CONFIG,
      colors: {
        ...DEFAULT_USAGE_CONFIG.colors,
        custom: {
          mode: "step",
          stops: [{ percent: 100, color: "success" }],
        },
      },
    };
    writeJson(projectConfigPath, original);

    const { command, ctx } = createSettingsHarness({
      loadConfig: () => loadUsageConfig({ cwd, home }),
    });

    await command(`set colors.custom '[{"percent":100,"color":true}]'`, ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");

    const persisted = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
    expect(persisted).toEqual(original);

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects malformed integer settings values", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("set refreshIntervalMs 12abc", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");
  });

  it("rejects out-of-range common refresh interval settings", async () => {
    const { command, ctx } = createSettingsHarness();

    await command("set refreshIntervalMs 1", ctx);

    const text = lastNotifyText(ctx);
    expect(text).toContain("Invalid /openai-usage-settings usage.");
  });
});
