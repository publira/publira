"use client";

/**
 * `@publira/ui-components` is bundled by `tsdown`, which drops the
 * `"use client"` directive, and `useOffline()` cannot run in the server graph.
 */
export { OfflineNotice } from "@publira/ui-components/offline-notice";
