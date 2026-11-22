/**
 * `locale` as `next/root-params` exposes it before an app's generated types
 * exist. Each app's `locale()` returns `Promise<string>`; this is the wider
 * value `getLocale` narrows. The file is not a build entry, so the published
 * declarations do not redeclare the module.
 */
declare module "next/root-params" {
  export function locale(): Promise<string | string[] | undefined>;
}
