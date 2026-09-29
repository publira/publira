import { SURFACE_AVAILABILITIES } from "./surface-availability";
import type { SurfaceAvailabilityValue } from "./surface-availability";

/**
 * What a series or an episode states of its own about where it may be bought.
 * The empty value is following the level above — the tenant for a series, the
 * series for an episode — stored as no value at all, so it keeps following
 * after that level changes.
 *
 * Unlike where a work is shown, a stated value replaces the one above rather
 * than narrowing it.
 */
export type PurchaseAvailabilityOverride = "" | SurfaceAvailabilityValue;

export const PURCHASE_AVAILABILITY_OVERRIDES = [
  "",
  ...SURFACE_AVAILABILITIES,
] as const satisfies readonly PurchaseAvailabilityOverride[];

export const isPurchaseAvailabilityOverride = (
  value: string
): value is PurchaseAvailabilityOverride =>
  PURCHASE_AVAILABILITY_OVERRIDES.some((override) => override === value);

/** Where a level that states `override` may be bought, given what it inherits. */
export const resolvePurchaseAvailability = (
  inherited: SurfaceAvailabilityValue,
  override: PurchaseAvailabilityOverride
): SurfaceAvailabilityValue => override || inherited;
