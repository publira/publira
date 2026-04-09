"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import Link from "next/link";

import { createOperatorAction } from "../_lib/actions";

const ROLE_OPTIONS = [
  { label: "スーパー管理者", value: "platform_super_admin" },
  { label: "オペレーター", value: "platform_operator" },
  { label: "監査担当", value: "platform_auditor" },
] as const;

export const CreateOperatorForm = () => (
  <ActionForm action={createOperatorAction} className="grid gap-4 sm:max-w-2xl">
    {({ isPending, state }) => (
      <>
        <Field>
          <FieldLabel htmlFor="operator_name" required>
            名前
          </FieldLabel>
          <FieldContent>
            <Input
              id="operator_name"
              name="operator_name"
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="operator_email" required>
            メールアドレス
          </FieldLabel>
          <FieldContent>
            <Input
              id="operator_email"
              name="operator_email"
              placeholder="operator@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="operator_role" required>
            ロール
          </FieldLabel>
          <FieldContent>
            <Select
              id="operator_role"
              items={ROLE_OPTIONS}
              name="operator_role"
              placeholder="選択してください"
              required
            />
          </FieldContent>
        </Field>

        {state && !state.ok ? (
          <FormMessage variant="destructive">{state.message}</FormMessage>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button disabled={isPending} type="submit">
            {isPending ? "追加中..." : "追加"}
          </Button>
          <LinkButton render={<Link href="/operators" />} variant="outline">
            キャンセル
          </LinkButton>
        </div>
      </>
    )}
  </ActionForm>
);
