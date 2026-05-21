/**
 * Attribution:
 * Settings command structure is adapted from usage-specific patterns of the
 * Reference Implementation (pi-better-openai), which is MIT-licensed. The ported
 * scope is intentionally limited to usage configuration, diagnostics, and
 * operational status for this extension.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  type LoadedUsageConfig,
  loadUsageConfig,
} from "./config";
import { resolveCodexOAuthCredentials, type CodexCredentialResolution } from "./auth";
import { createUsageCommandFacade } from "./usage-command-facade";
import {
  createUsageRefreshCoordinator,
  type UsageRefreshCoordinator,
} from "./usage-refresh-coordinator";
import {
  fetchCodexUsage,
  type UsageClientPort,
} from "./usage-client";
import { type UsageStateStore, createUsageStateStore } from "./usage-state";
import { formatDiagnosticsReport } from "./diagnostics-reporter";
import { openInteractiveSettingsMenu } from "./interactive-settings-menu";

type UsageSettingsCommandContext = Pick<
  ExtensionCommandContext,
  "ui" | "model" | "modelRegistry" | "signal" | "hasUI"
>;

type UsageSettingsCommandDependencies = {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: (
    ctx: UsageSettingsCommandContext,
  ) => Promise<CodexCredentialResolution>;
  usageClient?: UsageClientPort;
  usageState?: UsageStateStore;
  usageRefreshCoordinator?: UsageRefreshCoordinator;
};

const defaultUsageClient: UsageClientPort = {
  fetchUsage: fetchCodexUsage,
};

export type { UsageSettingsCommandDependencies };

export function registerOpenAIUsageSettingsCommand(
  pi: ExtensionAPI,
  dependencies: UsageSettingsCommandDependencies = {},
): void {
  const loadConfig = dependencies.loadConfig ?? loadUsageConfig;
  const resolveCredentials = dependencies.resolveCredentials ?? defaultResolveCredentials;
  const usageClient = dependencies.usageClient ?? defaultUsageClient;
  const usageState = dependencies.usageState ?? createUsageStateStore();
  const usageRefreshCoordinator =
    dependencies.usageRefreshCoordinator ??
    createUsageRefreshCoordinator({ usageClient, usageState });
  const usageCommandFacade = createUsageCommandFacade({
    loadConfig,
    resolveCredentials: (ctx) => resolveCredentials(ctx as UsageSettingsCommandContext),
    usageRefreshCoordinator,
  });

  pi.registerCommand("openai-usage-settings", {
    description: "OpenAI usage settings and utility subcommands",
    getArgumentCompletions(argumentPrefix: string) {
      return suggestSettingsSubcommands(argumentPrefix);
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();
      const commandContext = asUsageSettingsContext(ctx);

      const lowered = trimmed.toLowerCase();
      if (trimmed.length === 0) {
        await handleShowSettings({ commandContext, loadConfig });
        return;
      }

      if (isSubcommandInvocation(lowered, "show")) {
        notify(ctx, removedShowPathText());
        return;
      }

      if (isSubcommandInvocation(lowered, "debug")) {
        notify(ctx, removedDebugPathText());
        return;
      }

      if (lowered === "usage") {
        await usageCommandFacade.showUsage(commandContext);
        return;
      }

      if (lowered === "refresh") {
        await usageCommandFacade.showUsage(commandContext, { forceRefresh: true });
        return;
      }

      if (lowered === "help") {
        notify(ctx, usageSettingsHelpText());
        return;
      }

      if (lowered === "diagnostics") {
        await handleDiagnostics({ commandContext, loadConfig, resolveCredentials, usageState });
        return;
      }

      if (isRemovedSetInvocation(lowered)) {
        notify(ctx, removedSetPathText());
        return;
      }

      notify(ctx, "Unknown /openai-usage-settings subcommand. Use /openai-usage-settings help");
    },
  });
}

async function handleShowSettings(options: {
  commandContext: UsageSettingsCommandContext;
  loadConfig: () => LoadedUsageConfig;
}): Promise<void> {
  const { commandContext, loadConfig } = options;
  if (!commandContext.hasUI || typeof commandContext.ui.custom !== "function") {
    notify(commandContext, usageSettingsNoUiFallbackText());
    return;
  }

  const loaded = loadConfig();
  await openInteractiveSettingsMenu(commandContext, loaded.effective);
}

async function handleDiagnostics(options: {
  commandContext: UsageSettingsCommandContext;
  loadConfig: () => LoadedUsageConfig;
  resolveCredentials: (ctx: UsageSettingsCommandContext) => Promise<CodexCredentialResolution>;
  usageState: UsageStateStore;
}): Promise<void> {
  const { commandContext, loadConfig, resolveCredentials, usageState } = options;
  const loaded = loadConfig();
  const credentials = await resolveCredentials(commandContext);
  notify(
    commandContext,
    formatDiagnosticsReport({
      loaded,
      credentials,
      usageState,
      runtime: commandContext,
    }),
  );
}

function isSubcommandInvocation(loweredArgs: string, subcommand: string): boolean {
  return loweredArgs === subcommand || loweredArgs.startsWith(`${subcommand} `);
}

function isRemovedSetInvocation(loweredArgs: string): boolean {
  return isSubcommandInvocation(loweredArgs, "set");
}

function removedShowPathText(): string {
  return [
    "The /openai-usage-settings show path was removed.",
    "Common settings are interactive through no-args /openai-usage-settings when UI is available.",
    "Use /openai-usage-settings help for supported utility subcommands.",
  ].join("\n");
}

function removedDebugPathText(): string {
  return [
    "The /openai-usage-settings debug path is not a diagnostics alias.",
    "Use /openai-usage-settings diagnostics for diagnostics.",
    "Use /openai-usage-settings help for supported utility subcommands.",
  ].join("\n");
}

function removedSetPathText(): string {
  return [
    "Slash-command setting writes were removed.",
    "Common settings are interactive now through no-args /openai-usage-settings when UI is available.",
    "Advanced settings can be edited in the JSON config file.",
    "Use /openai-usage-settings help for supported utility subcommands.",
  ].join("\n");
}

function usageSettingsNoUiFallbackText(): string {
  return [
    "Interactive settings require UI.",
    "This non-UI fallback is read-only and does not change configuration.",
    "Supported utility subcommands:",
    "  /openai-usage-settings usage",
    "  /openai-usage-settings refresh",
    "  /openai-usage-settings diagnostics",
    "  /openai-usage-settings help",
  ].join("\n");
}

function usageSettingsHelpText(): string {
  return [
    "/openai-usage-settings is the only OpenAI usage/settings command.",
    "Common settings are interactive through no-args /openai-usage-settings when UI is available.",
    "Advanced settings are JSON-file-only in the usage config file.",
    "",
    "Supported utility subcommands:",
    "  usage        Show cached usage and refresh when stale or missing",
    "  refresh      Force a usage refresh",
    "  diagnostics  Show runtime, auth, config, and raw-config diagnostics",
    "  help         Show this help",
  ].join("\n");
}

const SUPPORTED_UTILITY_SUBCOMMANDS = ["usage", "refresh", "diagnostics", "help"] as const;

function suggestSettingsSubcommands(argumentPrefix: string) {
  const prefix = argumentPrefix.trim().toLowerCase();
  const matches = SUPPORTED_UTILITY_SUBCOMMANDS
    .filter((command) => command.startsWith(prefix))
    .map((command) => ({
      value: command,
      label: command,
    }));
  return matches.length > 0 ? matches : null;
}

function asUsageSettingsContext(ctx: ExtensionCommandContext): UsageSettingsCommandContext {
  return ctx as UsageSettingsCommandContext;
}

function notify(ctx: UsageSettingsCommandContext, message: string): void {
  ctx.ui.notify(message, "info");
}

function defaultResolveCredentials(
  ctx: UsageSettingsCommandContext,
): Promise<CodexCredentialResolution> {
  return resolveCodexOAuthCredentials({ modelRegistry: ctx.modelRegistry });
}
