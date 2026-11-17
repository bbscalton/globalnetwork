/** Fields stored on customers/{id} when a paid usage window starts. */

export type UsagePeriodKind = "plan" | "renewal" | "extension" | "reactivation" | "adjust";

/** Start a fresh usage window at `now`, ending at the new paidUntilMs. */
export function usagePeriodFields(
  now: number,
  paidUntilMs: number | null | undefined,
  kind: UsagePeriodKind,
): {
  usagePeriodId: string;
  usagePeriodStartMs: number;
  usagePeriodEndMs: number | null;
  usagePeriodKind: UsagePeriodKind;
} {
  const end = paidUntilMs != null && Number.isFinite(Number(paidUntilMs)) && Number(paidUntilMs) > 0
    ? Number(paidUntilMs)
    : null;
  return {
    usagePeriodId: `p-${now}`,
    usagePeriodStartMs: now,
    usagePeriodEndMs: end,
    usagePeriodKind: kind,
  };
}
