import { notFound } from "next/navigation";

export const STATIC_PARAM_PLACEHOLDER = "__placeholder__" as const;

type PlaceholderParamValue = string | null | undefined;

export const createPlaceholderStaticParams = <const TParamName extends string>(
  ...paramNames: readonly TParamName[]
): Record<TParamName, typeof STATIC_PARAM_PLACEHOLDER>[] => [
  Object.fromEntries(
    paramNames.map((paramName) => [paramName, STATIC_PARAM_PLACEHOLDER])
  ) as Record<TParamName, typeof STATIC_PARAM_PLACEHOLDER>,
];

export const isPlaceholderStaticParam = (
  value: PlaceholderParamValue
): value is typeof STATIC_PARAM_PLACEHOLDER =>
  value === STATIC_PARAM_PLACEHOLDER;

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
