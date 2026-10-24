"use client";

import * as Identifier from "@publira/ui-components/identifier";

import { useClientMessages } from "#components/client-message";

/** Copies the gateway path, named for a screen reader. */
export const GatewayPathCopy = ({ value }: { value: string }) => {
  const t = useClientMessages();

  return (
    <Identifier.Copy
      aria-label={t("admin.settings.google_tag.gateway_path_copy")}
      value={value}
    />
  );
};
