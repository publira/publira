"use client";

/**
 * The accessor, for a client-only control whose DOM API needs a plain string —
 * an `aria-label` or a `title` that cannot take a node.
 *
 * The catalog comes from `<StorefrontMessagesProvider>`. On the server this
 * waits on that read; it has settled in the payload by the time the browser
 * hydrates, so the copy is there on the first client render and a caller needs
 * no `<Suspense>`. Keep the hook local to the control that needs it: an
 * accessor handed across a component boundary makes the key an implicit
 * attribute of whatever the caller happened to bind.
 */
export {
  ClientMessage,
  useClientMessages,
} from "./storefront-messages-context";
