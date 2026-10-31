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
 * The icons saving a policy may clear. The server clears what the policy
 * stored at that moment no longer allows, and the policy this card was drawn
 * with may be stale by then — another administrator can have widened it and
 * readers uploaded since — so the answer depends on the policy being saved
 * alone: `preset` may take down the images readers uploaded and leaves the
 * presets they picked, `disabled` may take down every icon, and `upload`
 * clears nothing.
 */
export type ReaderIconPolicyClearance = "all" | "none" | "uploads";

export const readerIconPolicyClearance = (
  policy: TenantReaderIconPolicy
): ReaderIconPolicyClearance => {
  switch (policy) {
    case "disabled": {
      return "all";
    }

    case "preset": {
      return "uploads";
    }

    default: {
      return "none";
    }
  }
};

/**
 * How many presets a tenant may hold. The API refuses one more with
 * `READER_ICON_PRESET_LIMIT`, and the card stops offering the upload at the
 * same count.
 */
export const READER_ICON_PRESET_LIMIT = 50;
