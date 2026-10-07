"use client";

import { IdentifierCopy } from "@publira/ui-components/identifier";

import { useClientMessages } from "#components/client-message";

/** Copies the URL the provider posts received mail to. */
export const InboundEmailWebhookUrlCopy = ({ value }: { value: string }) => {
  const t = useClientMessages();

  return (
    <IdentifierCopy
      aria-label={t("admin.settings.inbound_email.copy_webhook_url")}
      value={value}
    />
  );
};

/** Copies the address pattern readers' replies arrive at. */
export const InboundEmailReplyAddressCopy = ({ value }: { value: string }) => {
  const t = useClientMessages();

  return (
    <IdentifierCopy
      aria-label={t("admin.settings.inbound_email.copy_reply_address")}
      value={value}
    />
  );
};
