import { SurfaceAvailability } from "@publira/api-client/admin/types";

import { SURFACE_AVAILABILITIES } from "./surface-availability";
import type { SurfaceAvailabilityValue } from "./surface-availability";

/**
 * The proto enum each value stands for, read in both directions so the two
 * halves of the conversion cannot drift apart.
 */
export const SURFACE_AVAILABILITY_ENUM: Record<
  SurfaceAvailabilityValue,
  SurfaceAvailability
> = {
  all: SurfaceAvailability.ALL,
  app: SurfaceAvailability.APP,
  web: SurfaceAvailability.WEB,
};

/**
 * Unspecified — and a response that carried no field — maps to the empty value,
 * and a value naming none of the three to `undefined`, so each caller decides
 * what those mean for the message it reads.
 */
export const toSurfaceAvailabilityValue = (
  availability: SurfaceAvailability | undefined
): "" | SurfaceAvailabilityValue | undefined => {
  if (
    availability === undefined ||
    availability === SurfaceAvailability.UNSPECIFIED
  ) {
    return "";
  }
  return SURFACE_AVAILABILITIES.find(
    (value) => SURFACE_AVAILABILITY_ENUM[value] === availability
  );
};

/**
 * An override as the API takes it: the empty value is the unspecified one,
 * which a level reads as following the level above.
 */
export const toSurfaceAvailabilityOverrideEnum = (
  value: "" | SurfaceAvailabilityValue
): SurfaceAvailability =>
  value ? SURFACE_AVAILABILITY_ENUM[value] : SurfaceAvailability.UNSPECIFIED;
