export type UsageWindow = {
  used_percent?: unknown;
  reset_after_seconds?: unknown;
  reset_at?: unknown;
};

export type RateLimitBucket = {
  allowed?: unknown;
  limit_reached?: unknown;
  primary_window?: unknown;
  secondary_window?: unknown;
};

export type CodexUsageResponse = {
  rate_limit?: unknown;
  additional_rate_limits?: unknown;
};

export type UsageSnapshot = {
  fiveHourLeftPercent: number | null;
  sevenDayLeftPercent: number | null;
  fiveHourResetInSeconds: number | null;
  sevenDayResetInSeconds: number | null;
  isLimited: boolean;
};

export type ParseUsageSnapshotOptions = {
  modelId?: string;
  nowMs?: number;
};

const SPARK_MODEL_ID = "gpt-5.3-codex-spark";
const SPARK_LIMIT_NAME = "GPT-5.3-Codex-Spark";
const MILLISECONDS_EPOCH_THRESHOLD = 100_000_000_000;

export function parseUsageSnapshot(
  rawResponse: unknown,
  options: ParseUsageSnapshotOptions = {},
): UsageSnapshot {
  const response = asRecord(rawResponse);
  const rootBucket = normalizeRateLimitBucket(response?.rate_limit);
  const bucket =
    options.modelId === SPARK_MODEL_ID
      ? findSparkRateLimitBucket(response) ?? rootBucket
      : rootBucket;

  const primaryWindow = asRecord(bucket?.primary_window);
  const secondaryWindow = asRecord(bucket?.secondary_window);

  return {
    fiveHourLeftPercent: usedToRemainingPercent(primaryWindow?.used_percent),
    sevenDayLeftPercent: usedToRemainingPercent(secondaryWindow?.used_percent),
    fiveHourResetInSeconds: resetInSeconds(primaryWindow, options.nowMs),
    sevenDayResetInSeconds: resetInSeconds(secondaryWindow, options.nowMs),
    isLimited: bucket?.allowed === false || bucket?.limit_reached === true,
  };
}

function normalizeRateLimitBucket(value: unknown): RateLimitBucket | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;

  if (
    !("primary_window" in record) &&
    !("secondary_window" in record) &&
    !("allowed" in record) &&
    !("limit_reached" in record)
  ) {
    return undefined;
  }

  return record;
}

function findSparkRateLimitBucket(
  response: Record<string, unknown> | undefined,
): RateLimitBucket | undefined {
  if (response === undefined) return undefined;

  const additionalRateLimits = response.additional_rate_limits;
  if (Array.isArray(additionalRateLimits)) {
    for (const entry of additionalRateLimits) {
      const bucket = extractSparkBucketFromEntry(entry);
      if (bucket !== undefined) return bucket;
    }
    return undefined;
  }

  const additionalRateLimitMap = asRecord(additionalRateLimits);
  if (additionalRateLimitMap === undefined) return undefined;

  for (const entry of Object.values(additionalRateLimitMap)) {
    const bucket = extractSparkBucketFromEntry(entry);
    if (bucket !== undefined) return bucket;
  }
  return undefined;
}

function extractSparkBucketFromEntry(entry: unknown): RateLimitBucket | undefined {
  const record = asRecord(entry);
  if (record?.limit_name !== SPARK_LIMIT_NAME) return undefined;
  return normalizeRateLimitBucket(record.rate_limit);
}

function usedToRemainingPercent(value: unknown): number | null {
  if (!isFiniteNumber(value)) return null;
  return clampPercent(100 - value);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function resetInSeconds(
  window: Record<string, unknown> | undefined,
  nowMs = Date.now(),
): number | null {
  const resetAfterSeconds = window?.reset_after_seconds;
  if (isFiniteNumber(resetAfterSeconds)) return Math.max(0, resetAfterSeconds);

  const resetAt = window?.reset_at;
  if (!isFiniteNumber(resetAt)) return null;

  const resetAtSeconds =
    resetAt > MILLISECONDS_EPOCH_THRESHOLD ? resetAt / 1000 : resetAt;
  return Math.max(0, resetAtSeconds - nowMs / 1000);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
