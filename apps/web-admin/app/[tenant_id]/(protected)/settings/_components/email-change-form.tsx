"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useCallback, useState } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { EmailChangeActionState } from "../settings-types";

interface EmailChangeFormProps {
  action: (
    prevState: EmailChangeActionState,
    formData: FormData
  ) => Promise<EmailChangeActionState>;
}

export const EmailChangeForm = ({ action }: EmailChangeFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [currentEmail, setCurrentEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const handleCurrentEmailChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setCurrentEmail(event.target.value);
    },
    []
  );

  const handleNewEmailChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setNewEmail(event.target.value);
    },
    []
  );

  const handleCurrentPasswordChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setCurrentPassword(event.target.value);
    },
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>メールアドレス変更</CardTitle>
        <CardDescription>
          管理者アカウントのメールアドレスを変更します。変更には現在のメールアドレスと新しいメールアドレスの両方で確認が必要です。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel required>現在のメールアドレス</FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                name="current_email"
                onChange={handleCurrentEmailChange}
                placeholder="current@example.com"
                required
                type="email"
                value={currentEmail}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>新しいメールアドレス</FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                name="new_email"
                onChange={handleNewEmailChange}
                placeholder="new@example.com"
                required
                type="email"
                value={newEmail}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>現在のパスワード</FieldLabel>
            <FieldContent>
              <Input
                autoComplete="current-password"
                name="current_password"
                onChange={handleCurrentPasswordChange}
                placeholder="••••••••"
                required
                type="password"
                value={currentPassword}
              />
              <FieldDescription>
                セキュリティ上の理由から、パスワードの入力が必要です。
              </FieldDescription>
            </FieldContent>
          </Field>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {isPending ? "送信中..." : "確認メールを送信"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
