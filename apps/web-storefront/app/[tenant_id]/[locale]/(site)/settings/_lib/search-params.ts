import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

interface ParseSettingsFlashSearchParamsInput {
  message?: SearchParamValue;
  status?: SearchParamValue;
}

export interface SettingsFlashSearchParams {
  message: string;
  status: "" | "error" | "success";
}

const settingsFlashSearchParamsSchema = z.object({
  message: searchParamString({ fallback: "" }),
  status: searchParamEnum(["error", "success"], { fallback: "" }),
});

export const parseSettingsFlashSearchParams = (
  input: ParseSettingsFlashSearchParamsInput
): SettingsFlashSearchParams => settingsFlashSearchParamsSchema.parse(input);
