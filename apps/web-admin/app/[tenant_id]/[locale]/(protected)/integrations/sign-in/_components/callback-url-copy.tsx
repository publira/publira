"use client";

import * as Identifier from "@publira/ui-components/identifier";

import { useClientMessages } from "#components/client-message";

/** Copies a provider's callback URL, named for a screen reader. */
export const CallbackUrlCopy = ({ value }: { value: string }) => {
  const t = useClientMessages();

  return (
    <Identifier.Copy
      aria-label={t("admin.settings.sign_in.copy_callback_url")}
      value={value}
    />
  );
};
