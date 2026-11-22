"use client";

/**
 * The accessor a Client Component resolves its copy through, bound to the
 * catalog `PlatformMessagesProvider` carries.
 *
 * On the server this waits on that read under the boundary the surrounding
 * section already sits behind. The read has settled in the payload by the time
 * the browser hydrates, so the copy is there on the first client render and no
 * catalog is loaded in the browser. A route-level `error.tsx` reads it the
 * same way: the provider sits in the root layout, above both boundaries.
 */
export { ClientMessage, useClientMessages } from "./platform-messages-context";
