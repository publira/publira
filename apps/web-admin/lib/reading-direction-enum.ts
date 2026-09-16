import { ReadingDirection } from "@publira/api-client/admin/types";

import { READING_DIRECTIONS } from "./reading-layout";
import type { ReadingDirectionValue } from "./reading-layout";

/**
 * The proto enum each direction stands for, read in both directions so the two
 * halves of the conversion cannot drift apart.
 */
export const READING_DIRECTION_ENUM: Record<
  ReadingDirectionValue,
  ReadingDirection
> = {
  ltr: ReadingDirection.LEFT_TO_RIGHT,
  rtl: ReadingDirection.RIGHT_TO_LEFT,
};

/**
 * Unspecified — and a response that carried no field — maps to the empty value,
 * and a value naming neither direction to `undefined`, so each caller decides
 * what those mean for the message it reads.
 */
export const toReadingDirectionValue = (
  direction: ReadingDirection | undefined
): "" | ReadingDirectionValue | undefined => {
  if (direction === undefined || direction === ReadingDirection.UNSPECIFIED) {
    return "";
  }
  return READING_DIRECTIONS.find(
    (value) => READING_DIRECTION_ENUM[value] === direction
  );
};
