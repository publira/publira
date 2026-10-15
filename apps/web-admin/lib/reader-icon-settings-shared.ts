/**
 * What a tenant lets a reader show as an icon. The stored
 * `tenant_config.reader_icon_policy` values rather than the generated enum, so
 * the settings card, the `FormData` it submits, and the catalog keys naming
 * each option are all the same three strings.
 *
 * Kept apart from `reader-icon-settings.ts` because the settings card is a
 * Client Component: importing the value from the module that reads the session
 * would pull `next/headers` into the browser graph.
 */
export type TenantReaderIconPolicy = "disabled" | "preset" | "upload";

/** From the widest choice to the narrowest, in the order the card lists them. */
export const TENANT_READER_ICON_POLICIES = [
  "upload",
  "preset",
  "disabled",
] as const satisfies readonly TenantReaderIconPolicy[];

/**
 * The icons a save clears, from the policy the tenant has to the one it is
 * switching to. Narrowing to `preset` takes down the images readers uploaded
 * and leaves the presets they picked; narrowing to `disabled` takes down every
 * icon. Widening, or saving the same policy, clears nothing.
 */
export type ReaderIconPolicyClearance = "all" | "none" | "uploads";

export const readerIconPolicyClearance = (
  saved: TenantReaderIconPolicy,
  next: TenantReaderIconPolicy
): ReaderIconPolicyClearance => {
  if (next === saved) {
    return "none";
  }
  if (next === "disabled") {
    return "all";
  }
  // Coming from `disabled`, readers show no icon for `preset` to clear.
  return next === "preset" && saved === "upload" ? "uploads" : "none";
};

/**
 * How many presets a tenant may hold. The API refuses one more with
 * `READER_ICON_PRESET_LIMIT`, and the card stops offering the upload at the
 * same count.
 */
export const READER_ICON_PRESET_LIMIT = 50;
