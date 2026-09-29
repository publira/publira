/**
 * Placeholder value used by `generateStaticParams` when a dynamic segment has
 * no enumerable values at build time.
 *
 * Kept free of `next/navigation` so Route Handlers can import it: the
 * app-route module graph cannot resolve `app-router-context`, and pulling in
 * `notFound()` there fails the route with
 * "Could not parse module ... app-router-context.js".
 * Server Components should use `guardPlaceholder` from `./next-static-params`.
 */
export const STATIC_PARAM_PLACEHOLDER = "__placeholder__" as const;

export type PlaceholderParamValue = string | null | undefined;

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
