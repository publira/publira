import { notFound } from "next/navigation";

import { isPlaceholderStaticParam } from "./static-param-placeholder";
import type { PlaceholderParamValue } from "./static-param-placeholder";

export {
  createPlaceholderStaticParams,
  isPlaceholderStaticParam,
  STATIC_PARAM_PLACEHOLDER,
} from "./static-param-placeholder";
export type { PlaceholderParamValue } from "./static-param-placeholder";

/**
 * Server Components only — `notFound()` needs the app-router context, which
 * Route Handlers do not have. There, compare with `isPlaceholderStaticParam`
 * from `@publira/utils/static-param-placeholder` and return a `Response`.
 */
export const guardPlaceholder = (value: PlaceholderParamValue): void => {
  if (isPlaceholderStaticParam(value)) {
    notFound();
  }
};

export const guardPlaceholders = (
  params: Record<string, PlaceholderParamValue>
): void => {
  for (const value of Object.values(params)) {
    guardPlaceholder(value);
  }
};
