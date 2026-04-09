"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";

import { loginAction } from "../_lib/actions";

export const LoginForm = ({
  nextPath,
  resetDone,
}: {
  nextPath?: string;
  resetDone?: boolean;
}) => (
  <>
    <ActionForm
      action={loginAction}
      className="space-y-4"
      pendingLabel="ログイン中..."
      submitClassName="mt-2 w-full"
      submitLabel="ログイン"
    >
      <input name="next" type="hidden" value={nextPath} />

      <Field>
        <FieldLabel htmlFor="email" required>
          メールアドレス
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="email"
            id="email"
            name="email"
            placeholder="operator@example.com"
            required
            type="email"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="password" required>
          パスワード
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="current-password"
            id="password"
            name="password"
            placeholder="••••••••"
            required
            type="password"
          />
        </FieldContent>
      </Field>

      {resetDone ? (
        <FormMessage variant="success">
          パスワードが再設定されました。新しいパスワードでログインしてください。
        </FormMessage>
      ) : null}
    </ActionForm>

    <div className="mt-4 text-center text-sm">
      <Link
        className="font-medium text-primary hover:underline"
        href="/reset-password"
      >
        パスワードを忘れた場合
      </Link>
    </div>
  </>
);
