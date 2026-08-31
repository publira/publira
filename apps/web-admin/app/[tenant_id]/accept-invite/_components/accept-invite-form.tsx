import { getMessage } from "@publira/i18n";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { acceptInviteAction } from "../_lib/actions";

/** The only localized attribute in this form needs a string rather than a node. */
const NameField = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return (
    <Field>
      <FieldLabel htmlFor="name" required>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.auth.accept_invite.name_label" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          id="name"
          name="name"
          placeholder={getMessage(
            messages,
            "admin.auth.accept_invite.name_placeholder"
          )}
          required
          type="text"
        />
      </FieldContent>
    </Field>
  );
};

export const AcceptInviteForm = ({
  token,
  email,
  tenantId,
  accountExists,
}: {
  token: string;
  email: string;
  tenantId: string;
  accountExists: boolean;
}) => (
  <ActionForm action={acceptInviteAction} className="space-y-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="token" type="hidden" value={token} />
    <input name="account_exists" type="hidden" value={String(accountExists)} />
    <input name="email" type="hidden" value={email} />

    {accountExists ? (
      <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.accept_invite.account_exists" />
        </Suspense>
      </p>
    ) : (
      <>
        <Suspense fallback={<Skeleton className="h-11 w-full" />}>
          <NameField />
        </Suspense>

        <Field>
          <FieldLabel htmlFor="password" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.auth.fields.password_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="password"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="confirm_password" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.auth.accept_invite.password_confirm_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="new-password"
              id="confirm_password"
              name="confirm_password"
              placeholder="••••••••"
              required
              type="password"
            />
          </FieldContent>
        </Field>
      </>
    )}

    <ActionFormSubmit className="w-full" variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <Message message="admin.auth.accept_invite.submit" />
      </Suspense>
    </ActionFormSubmit>
  </ActionForm>
);
