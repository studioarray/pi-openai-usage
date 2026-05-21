import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  resolveCodexOAuthCredentials,
  type CodexCredentialResolution,
} from "./auth";
import { type UsageRefreshCoordinator, type UsageRefreshResult } from "./usage-refresh-coordinator";
import type { UsageConfig } from "./config";
import {
  appendUsageRefreshFailureMarker,
  formatUsageAuthFailedStatusLine,
  formatUsageLoginRequiredStatusLine,
  formatUsageRefreshFailedStatusLine,
  formatUsageStatusLine,
} from "./format";
import { type LoadedUsageConfig, loadUsageConfig } from "./config";
import type { UsageClientPort, UsageFetchError } from "./usage-client";
import { USAGE_ENDPOINT, fetchCodexUsage } from "./usage-client";
import { createUsageRefreshCoordinator } from "./usage-refresh-coordinator";
import { createUsageStateStore, type UsageStateStore } from "./usage-state";

const defaultUsageClient: UsageClientPort = {
  fetchUsage: fetchCodexUsage,
};

export type UsageCommandDependencies = {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: (ctx: UsageCommandContext) => Promise<CodexCredentialResolution>;
  usageClient?: UsageClientPort;
  usageState?: UsageStateStore;
  usageRefreshCoordinator?: UsageRefreshCoordinator;
};

type UsageCommandContext = Pick<ExtensionCommandContext, "ui" | "model" | "modelRegistry" | "signal">;



export function registerOpenAIUsageCommand(
  pi: ExtensionAPI,
  dependencies: UsageCommandDependencies = {},
): void {
  const loadConfig = dependencies.loadConfig ?? loadUsageConfig;
  const resolveCredentials = dependencies.resolveCredentials ?? defaultResolveCredentials;
  const usageState = dependencies.usageState ?? createUsageStateStore();
  const usageClient = dependencies.usageClient ?? defaultUsageClient;
  const usageRefreshCoordinator =
    dependencies.usageRefreshCoordinator ?? createUsageRefreshCoordinator({ usageClient, usageState });

  pi.registerCommand("openai-usage", {
    description: "Show usage status, force refresh, or show usage diagnostics",
    getArgumentCompletions: (argumentPrefix) => suggestUsageSubcommands(argumentPrefix),
    handler: async (args, ctx) => {
      const trimmed = args.trim().toLowerCase();
      const [subcommand] = trimmed.length === 0 ? [] : trimmed.split(/\s+/);

      if (subcommand === undefined) {
        await handleUsageQuery({
          ctx: asUsageCommandContext(ctx),
          loadConfig,
          resolveCredentials,
          usageState,
          usageRefreshCoordinator,
        });
        return;
      }

      if (subcommand === "refresh") {
        await handleUsageQuery({
          ctx: asUsageCommandContext(ctx),
          loadConfig,
          resolveCredentials,
          usageState,
          usageRefreshCoordinator,
          forceRefresh: true,
        });
        return;
      }

      if (subcommand === "debug") {
        await handleDebug({
          ctx: asUsageCommandContext(ctx),
          loadConfig,
          resolveCredentials,
          usageState,
        });
        return;
      }

      if (subcommand === "help") {
        notify(ctx, usageHelpText());
        return;
      }

      notify(ctx, `Unknown /openai-usage subcommand \"${args.trim()}\". Use /openai-usage help`);
    },
  });
}

async function handleUsageQuery(options: {
  ctx: UsageCommandContext;
  loadConfig: () => LoadedUsageConfig;
  resolveCredentials: (ctx: UsageCommandContext) => Promise<CodexCredentialResolution>;
  usageState: UsageStateStore;
  usageRefreshCoordinator: UsageRefreshCoordinator;
  forceRefresh?: boolean;
}): Promise<void> {
  const { ctx, loadConfig, resolveCredentials, usageState, usageRefreshCoordinator, forceRefresh } = options;

  const initialConfig = loadConfig().effective;
  const credentials = await resolveCredentials(ctx);
  if (!credentials.ok) {
    notify(ctx, formatUsageLoginRequiredStatusLine());
    return;
  }

  const refreshResult = await usageRefreshCoordinator.refresh({
    credentials: credentials.credentials,
    signal: ctx.signal,
    modelId: ctx.model?.id,
    staleAfterMs: initialConfig.refreshIntervalMs,
    force: forceRefresh,
  });

  const latestConfig = loadConfig().effective;
  const statusText = resolveUsageStatusText(latestConfig, refreshResult, ctx.ui.theme);
  notify(ctx, statusText ?? "Usage refresh failed");
}

function resolveUsageStatusText(
  config: UsageConfig,
  refreshResult: UsageRefreshResult,
  theme?: UsageCommandContext["ui"]["theme"],
): string | undefined {
  if (refreshResult.status === "failed") {
    if (refreshResult.error.kind === "auth") {
      return formatUsageAuthFailedStatusLine();
    }

    const cachedText = formatUsageStatusLine({
      snapshot: refreshResult.snapshot,
      config,
      theme,
    });
    if (cachedText !== undefined) {
      return appendUsageRefreshFailureMarker(cachedText, theme);
    }

    return formatUsageRefreshFailedStatusLine();
  }

  return formatUsageStatusLine({
    snapshot: refreshResult.snapshot,
    config,
    theme,
  });
}

async function handleDebug(options: {
  ctx: UsageCommandContext;
  loadConfig: () => LoadedUsageConfig;
  resolveCredentials: (ctx: UsageCommandContext) => Promise<CodexCredentialResolution>;
  usageState: UsageStateStore;
}): Promise<void> {
  const { ctx, loadConfig, resolveCredentials, usageState } = options;

  const loaded = loadConfig();
  const credentials = await resolveCredentials(ctx);

  const lines = [
    "openai-usage debug",
    `Config path: ${loaded.configPath}`,
    `Project config path: ${loaded.projectConfigPath}`,
    `Global config path: ${loaded.globalConfigPath}`,
    `Auth source: ${credentials.diagnostics.source}`,
    `Checked auth sources: ${credentials.diagnostics.checkedSources.join(", ") || "<none>"}`,
    `Has access token: ${formatBooleanText(credentials.diagnostics.hasAccessToken)}`,
    `Has account ID: ${formatBooleanText(credentials.diagnostics.hasAccountId)}`,
    `Account ID: ${credentials.diagnostics.accountId ?? "<missing>"}`,
    `Endpoint: ${USAGE_ENDPOINT}`,
    `Last fetch: ${formatDateTime(usageState.getLastAttemptAt())}`,
    `Last success: ${formatDateTime(usageState.getLastSuccessAt())}`,
    `Last error: ${formatLastError(usageState.getLastError())}`,
    `Config enabled: ${loaded.effective.enabled ? "yes" : "no"}`,
    `Refresh interval (ms): ${loaded.effective.refreshIntervalMs}`,
  ];

  if (credentials.ok) {
    lines.push(`Credential source: ${credentials.toJSON().credentials.source}`);
    lines.push(`Credential account ID (redacted): ${credentials.toJSON().credentials.accountId}`);
  } else {
    lines.push(`Credential error: ${credentials.error.message}`);
  }

  notify(ctx, lines.join("\n"));
}

function formatDateTime(value: Date | undefined): string {
  return value === undefined ? "<none>" : value.toISOString();
}

function formatBooleanText(value: boolean): string {
  return value ? "yes" : "no";
}

function formatLastError(error: UsageFetchError | undefined): string {
  if (error === undefined) return "<none>";
  if (error.status === undefined) {
    return `${error.kind}: ${error.message}`;
  }
  return `${error.kind} (${error.status}): ${error.message}`;
}

function suggestUsageSubcommands(argumentPrefix: string) {
  const prefix = argumentPrefix.trim().toLowerCase();
  const subcommands = ["refresh", "debug", "help"];
  const matches = subcommands
    .filter((cmd) => cmd.startsWith(prefix))
    .map((cmd) => ({ value: cmd, label: cmd }));

  return matches.length > 0 ? matches : null;
}

function usageHelpText(): string {
  return [
    "/openai-usage [subcommand]",
    "Available subcommands:",
    "  (none)  Show cached usage (and refresh if stale/missing)",
    "  refresh Force a new usage refresh and join an in-flight refresh",
    "  debug   Show config paths and runtime diagnostics",
    "  help    Show this help",
  ].join("\n");
}

function notify(ctx: UsageCommandContext, message: string): void {
  ctx.ui.notify(message, "info");
}

function defaultResolveCredentials(
  ctx: UsageCommandContext,
): Promise<CodexCredentialResolution> {
  return resolveCodexOAuthCredentials({ modelRegistry: ctx.modelRegistry });
}

function asUsageCommandContext(ctx: ExtensionCommandContext): UsageCommandContext {
  return ctx as UsageCommandContext;
}
