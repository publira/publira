"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import { useTenantId } from "#lib/use-tenant-id";

import { acceptInviteAction } from "../_lib/actions";

export const AcceptInviteForm = ({
  token,
  email,
  accountExists,
}: {
  token: string;
  email: string;
  accountExists: boolean;
}) => {
  const tenantId = useTenantId();

  return (
    <ActionForm
      action={acceptInviteAction}
      className="space-y-4"
      pendingLabel="承諾中..."
      submitClassName="w-full"
      submitLabel="招待を承諾する"
      submitVariant="outline"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="token" type="hidden" value={token} />
      <input
        name="account_exists"
        type="hidden"
        value={String(accountExists)}
      />
      <input name="email" type="hidden" value={email} />

      {accountExists ? (
        <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          既存アカウントとして承諾します。承諾後はこのメールアドレスでログインできます。
        </p>
      ) : (
        <>
          <Field>
            <FieldLabel required>お名前</FieldLabel>
            <FieldContent>
              <Input name="name" placeholder="山田 太郎" required type="text" />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>パスワード</FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                name="password"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>パスワード（確認）</FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                name="confirm_password"
                placeholder="••••••••"
                required
                type="password"
              />
            </FieldContent>
          </Field>
        </>
      )}
    </ActionForm>
  );
};
