"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";

import { requestPasswordResetAction } from "../_lib/actions";

export const ResetPasswordForm = ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <ActionForm
        action={requestPasswordResetAction}
        className="space-y-4"
        pendingLabel="送信中..."
        submitClassName="mt-2 w-full"
        submitLabel="再設定メールを送信"
      >
        <input name="tenantPublicId" type="hidden" value={tenantPublicId} />

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
      <Link href="/login" className="font-medium text-primary hover:underline">
        ログイン画面へ戻る
      </Link>
    </div>
  </>
);
