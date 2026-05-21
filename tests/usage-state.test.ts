import { describe, expect, it } from "vitest";

import { createUsageStateStore } from "../src/usage-state";
import type { UsageSnapshot } from "../src/usage-snapshot";

const snapshot: UsageSnapshot = {
  fiveHourLeftPercent: 88,
  sevenDayLeftPercent: 73,
  fiveHourResetInSeconds: 600,
  sevenDayResetInSeconds: 86_400,
  isLimited: false,
};

describe("usage state store", () => {
  it("owns the cached parsed snapshot independent of the usage client", () => {
    const store = createUsageStateStore();

    expect(store.getSnapshot()).toBeUndefined();

    store.storeSnapshot(snapshot, new Date("2026-01-01T00:00:00.000Z"));

    expect(store.getSnapshot()).toEqual(snapshot);
    expect(store.getLastSuccessAt()).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("keeps historical last errors while clearing only current transient failure state on refresh success", () => {
    const store = createUsageStateStore();

    store.recordFetchError({ kind: "network", message: "temporary network issue" });
    expect(store.getCurrentError()).toEqual({ kind: "network", message: "temporary network issue" });
    expect(store.getLastError()).toEqual({ kind: "network", message: "temporary network issue" });

    store.storeSnapshot(snapshot, new Date("2026-01-01T00:00:05.000Z"));

    expect(store.getCurrentError()).toBeUndefined();
    expect(store.getLastError()).toEqual({ kind: "network", message: "temporary network issue" });
  });
});
