import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

/** Resolves the catalog itself: its placeholder needs a string rather than a node. */
export const NameField = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return (
    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.auth.accept_invite.name_label" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          name="name"
          placeholder={t("admin.auth.accept_invite.name_placeholder")}
          required
          type="text"
        />
      </Field.Content>
    </Field.Root>
  );
};
