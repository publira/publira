"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";

import { loginAction } from "../_lib/actions";

export const LoginForm = ({ returnToPath }: { returnToPath: string }) => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <ActionForm
        action={loginAction}
        className="space-y-4"
        pendingLabel="ログイン中..."
        submitClassName="mt-2 w-full"
        submitLabel="ログイン"
      >
        <input name="returnTo" type="hidden" value={returnToPath} />

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
      </ActionForm>
    </div>

    <div className="mt-4 text-center text-sm">
      <span className="text-muted-foreground">
        アカウントをお持ちでない方は
      </span>{" "}
      <Link href="/signup" className="font-medium text-primary hover:underline">
        新規登録
      </Link>
    </div>
  </>
);
