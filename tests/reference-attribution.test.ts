import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type AttributionAwareModule = {
  path: string;
  label: string;
};

const packageRoot = process.cwd();

const adaptedModules: AttributionAwareModule[] = [
  {
    label: "usage snapshot parser",
    path: join(packageRoot, "src", "usage-snapshot.ts"),
  },
  {
    label: "usage client",
    path: join(packageRoot, "src", "usage-client.ts"),
  },
  {
    label: "configuration store",
    path: join(packageRoot, "src", "config.ts"),
  },
  {
    label: "status formatter",
    path: join(packageRoot, "src", "format.ts"),
  },
  {
    label: "settings command",
    path: join(packageRoot, "src", "usage-settings.ts"),
  },
];

describe("reference attribution compliance", () => {
  it("ships root license, README, and third-party reference notices", () => {
    const requiredArtifacts = [
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      join("docs", "reference-attribution-compliance-audit-notes.md"),
    ];

    for (const artifact of requiredArtifacts) {
      expect(existsSync(join(packageRoot, artifact)), `${artifact} should exist`).toBe(true);
    }

    const notice = readFileSync(join(packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notice).toContain("pi-better-openai");
    expect(notice).toContain("MIT License");
    expect(notice).toContain("usage-specific");
  });

  it("allow-lists package documentation and license artifacts for distribution", () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      files?: string[];
    };

    expect(packageJson.files).toEqual(expect.arrayContaining([
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "docs/reference-attribution-compliance-audit-notes.md",
      "index.ts",
      "src",
    ]));
  });

  it("keeps explicit MIT attribution notices on usage-specific adapted modules", () => {
    for (const module of adaptedModules) {
      const source = readFileSync(module.path, "utf8");
      expect(source).toContain("Reference");
      expect(source).toContain("Implementation");
      expect(source).toContain("pi-better-openai");
      expect(source).toContain("MIT-licensed");
    }
  });

  it("keeps adapted modules usage-scoped", () => {
    const disallowedTerms = [
      "service_tier",
      "pi-openai-fast",
      "custom footer",
      "setfooter",
      "image",
      "image generation",
      "pet mode",
      "pets",
    ];
    for (const module of adaptedModules) {
      const source = readFileSync(module.path, "utf8").toLowerCase();
      for (const term of disallowedTerms) {
        expect(source.includes(term)).toBe(false);
      }
    }
  });
});
