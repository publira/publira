"use client";

/**
 * The client half of `<PlatformLocaleSwitcher>`.
 *
 * `@publira/ui-components` is bundled by `tsdown`, which drops the
 * `"use client"` directive, so a component imported straight from the package
 * is evaluated in the server graph. `LocaleSwitcher` cannot survive that: it
 * hands `<form action>` a callback of its own, and a function created in the
 * server graph cannot be serialized into the client component that renders the
 * popover. Next.js compiles this module from source, so the directive stands
 * and the whole control lands in the client graph; only the Server Action and
 * the resolved copy cross the boundary. Same split as `action-form.tsx`.
 */
export { LocaleSwitcher } from "@publira/ui-components/locale-switcher";
