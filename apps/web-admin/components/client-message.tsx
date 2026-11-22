"use client";

/**
 * The accessor a Client Component resolves its copy through, bound to the
 * catalog `AdminLocaleProvider` carries and the locale it carries beside it.
 *
 * On the server this waits on that read under the boundary the surrounding
 * section already sits behind. The read has settled in the payload by the time
 * the browser hydrates, so the copy is there on the first client render and no
 * catalog is loaded in the browser. A route-level `error.tsx` reads it the
 * same way: the provider sits in the root layout, above both boundaries.
 * Missing the provider is a wiring bug rather than a case to fall back from —
 * a component rendered outside one has no locale to answer in.
 */
export { ClientMessage, useClientMessages } from "./admin-locale-context";
