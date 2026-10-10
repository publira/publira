"use client";

import { IdentifierCopy } from "@publira/ui-components/identifier";

import { useClientMessages } from "#components/client-message";

/** Copies the address the tenant's mail is sent from, named for a screen reader. */
export const EmailSenderCopy = ({ value }: { value: string }) => {
  const t = useClientMessages();

  return (
    <IdentifierCopy
      aria-label={t("admin.settings.sign_in.apple.copy_email_sender")}
      value={value}
    />
  );
};
