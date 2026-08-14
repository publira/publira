import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";

const flashFlagSchema = searchParamEnum(["1"], { fallback: "" });

/** True only when the flash query is the literal `1` this screen posts. */
export const isFlashFlagSet = (value: SearchParamValue | null): boolean =>
  flashFlagSchema.parse(value ?? undefined) === "1";
