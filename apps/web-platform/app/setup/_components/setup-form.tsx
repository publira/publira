"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import { setupAction } from "../_lib/actions";

export const SetupForm = () => (
  <ActionForm
    action={setupAction}
    className="space-y-4"
    pendingLabel="作成中..."
    submitClassName="mt-2 w-full"
    submitLabel="管理ユーザーを作成する"
  >
    <Field>
      <FieldLabel htmlFor="name" required>
        氏名
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="name"
          id="name"
          name="name"
          placeholder="管理者 太郎"
          required
          type="text"
        />
      </FieldContent>
    </Field>

    <Field>
      <FieldLabel htmlFor="email" required>
        メールアドレス
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="email"
          id="email"
          name="email"
          placeholder="admin@example.com"
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
      <FieldLabel htmlFor="confirmPassword" required>
        パスワード（確認）
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="new-password"
          id="confirmPassword"
          name="confirmPassword"
          placeholder="••••••••"
          required
          type="password"
        />
      </FieldContent>
    </Field>
  </ActionForm>
);
