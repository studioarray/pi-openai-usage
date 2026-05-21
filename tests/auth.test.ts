import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { authFilePath, resolveCodexOAuthCredentials } from "../src/auth";

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createJwtPayload(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64url");
  return `header.${encodedPayload}.signature`;
}

describe("codex OAuth credential resolver", () => {
  it("resolves access token and account ID from openai-codex registry JSON", async () => {
    const modelRegistry = {
      getApiKeyForProvider: vi.fn(async (provider: string) => {
        expect(provider).toBe("openai-codex");
        return JSON.stringify({ access: "registry-access-token", accountId: "acct-registry" });
      }),
    };

    const result = await resolveCodexOAuthCredentials({ modelRegistry });

    expect(result).toMatchObject({
      ok: true,
      credentials: {
        accessToken: "registry-access-token",
        accountId: "acct-registry",
        source: "registry",
      },
      diagnostics: {
        source: "registry",
        hasAccessToken: true,
        hasAccountId: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("registry-access-token");
  });

  it("accepts registry token/account_id JSON without consulting the auth file", async () => {
    const modelRegistry = {
      getApiKeyForProvider: vi.fn(async () =>
        JSON.stringify({ token: "registry-token", account_id: "acct-snake" }),
      ),
    };

    const result = await resolveCodexOAuthCredentials({
      modelRegistry,
      authFilePath: "/definitely/missing/auth.json",
    });

    expect(result).toMatchObject({
      ok: true,
      credentials: {
        accessToken: "registry-token",
        accountId: "acct-snake",
        source: "registry",
      },
      diagnostics: {
        checkedSources: ["registry"],
      },
    });
  });

  it("extracts the account ID from a plain registry JWT", async () => {
    const jwt = createJwtPayload({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-from-jwt",
      },
    });
    const modelRegistry = {
      getApiKeyForProvider: vi.fn(async () => jwt),
    };

    const result = await resolveCodexOAuthCredentials({ modelRegistry });

    expect(result).toMatchObject({
      ok: true,
      credentials: {
        accessToken: jwt,
        accountId: "acct-from-jwt",
        source: "registry",
      },
    });
  });

  it("falls back to auth.json and accepts accountId or account_id", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-openai-usage-auth-"));
    try {
      const modelRegistry = {
        getApiKeyForProvider: vi.fn(async () => undefined),
      };

      for (const accountField of ["accountId", "account_id"] as const) {
        const authFile = join(root, accountField, "auth.json");
        writeJson(authFile, {
          "openai-codex": {
            type: "oauth",
            access: `auth-file-token-${accountField}`,
            [accountField]: `acct-file-${accountField}`,
          },
        });

        const result = await resolveCodexOAuthCredentials({ modelRegistry, authFilePath: authFile });

        expect(result).toMatchObject({
          ok: true,
          credentials: {
            accessToken: `auth-file-token-${accountField}`,
            accountId: `acct-file-${accountField}`,
            source: "auth_file",
          },
          diagnostics: {
            checkedSources: ["registry", "auth_file"],
          },
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a redacted setup error when Codex token or account ID is unavailable", async () => {
    const modelRegistry = {
      getApiKeyForProvider: vi.fn(async () =>
        JSON.stringify({ access: "token-without-account", accountId: "" }),
      ),
    };

    const result = await resolveCodexOAuthCredentials({
      modelRegistry,
      authFilePath: "/definitely/missing/auth.json",
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "missing_account_id",
        message: "Missing openai-codex Account ID. Run /login openai-codex.",
      },
      diagnostics: {
        source: "registry",
        checkedSources: ["registry", "auth_file"],
        hasAccessToken: true,
        hasAccountId: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("token-without-account");
  });

  it("builds the default auth-file path from PI_CODING_AGENT_DIR before home fallback", () => {
    expect(authFilePath({ env: { PI_CODING_AGENT_DIR: "/tmp/pi-agent" }, home: "/home/test" }))
      .toBe("/tmp/pi-agent/auth.json");
    expect(authFilePath({ env: {}, home: "/home/test" })).toBe(
      "/home/test/.pi/agent/auth.json",
    );
  });
});
