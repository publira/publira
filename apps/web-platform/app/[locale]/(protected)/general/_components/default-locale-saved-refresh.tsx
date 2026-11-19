"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { useRouter } from "next/navigation";

/**
 * Renders the console again through `proxy.ts` once a new default language is
 * saved.
 *
 * An operator who chose no display language of their own reads the console in
 * the saved default, which the proxy resolves before routing the request onto
 * the `[locale]` segment. The Action's own re-render was routed on the default
 * it replaced, so without this the screen that saved the setting would keep
 * the previous language until the next navigation.
 */
export const DefaultLocaleSavedRefresh = () => {
  const router = useRouter();

  ActionForm.useSettled((state) => {
    if (state?.ok) {
      router.refresh();
    }
  });

  return null;
};
