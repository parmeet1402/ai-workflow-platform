/** Shared copy for UI banner / API 403 when org usage is at or over the cap. */
export const MONTHLY_USAGE_CAP_ERROR =
  "Monthly usage cap reached. Raise the cap or wait until next month.";

export function isOverMonthlyUsageCap(used: number, cap: number): boolean {
  return Number.isFinite(used) && Number.isFinite(cap) && cap > 0 && used >= cap;
}
