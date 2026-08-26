"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { useTenantId } from "#lib/use-tenant-id";

import { requestPasswordResetAction } from "../_lib/actions";

export const ResetPasswordForm = () => {
  const tenantId = useTenantId();

  return (
    <>
      <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <ActionForm
          action={requestPasswordResetAction}
          className="space-y-4"
          pendingLabel="送信中..."
          submitClassName="mt-2 w-full"
          submitLabel="再設定メールを送信"
        >
          <LocaleField />
          <input name="tenantId" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel htmlFor="email" required>
              メールアドレス
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                id="email"
                name="email"
                placeholder="your@email.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>
        </ActionForm>
      </div>

      <div className="mt-4 text-center text-sm">
        <LocaleLink
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          ログイン画面へ戻る
        </LocaleLink>
      </div>
    </>
  );
};
