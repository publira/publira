"use client";

import { LOCALE_FIELD_NAME } from "@publira/locale/locale-field";
import * as LocaleSwitcher from "@publira/ui-components/locale-switcher";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { setAdminLocaleAction } from "#lib/locale-action";

interface AdminLocaleSwitcherRootProps {
  children: ReactNode;
  currentLocale: string;
}

/**
 * The switcher's root, with the step the Action cannot take itself.
 *
 * The Action writes the cookie, but the tree it re-renders in the same round
 * trip was routed onto the `[locale]` segment the old cookie named, so that
 * answer is still in the old language. Refreshing once the Action has settled
 * sends the current URL through `proxy.ts` again, which rewrites it onto the
 * new locale. Only the root parameter's value changes, so the router keeps the
 * same root layout and swaps the screen in place rather than reloading the
 * document.
 */
export const AdminLocaleSwitcherRoot = ({
  children,
  currentLocale,
}: AdminLocaleSwitcherRootProps) => {
  const router = useRouter();

  const switchLocale = async (formData: FormData) => {
    await setAdminLocaleAction(formData);
    router.refresh();
  };

  return (
    <LocaleSwitcher.Root
      action={switchLocale}
      currentLocale={currentLocale}
      fieldName={LOCALE_FIELD_NAME}
    >
      {children}
    </LocaleSwitcher.Root>
  );
};
