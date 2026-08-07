"use client";

import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { IssueAccessTicketActionState } from "../ticket-types";

interface TicketFormProps {
  action: (
    prevState: IssueAccessTicketActionState,
    formData: FormData
  ) => Promise<IssueAccessTicketActionState>;
}

export const TicketForm = ({ action }: TicketFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="grid gap-5">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel htmlFor="user_public_id" required>
              ユーザー public_id
            </FieldLabel>
            <FieldContent>
              <Input
                id="user_public_id"
                name="user_public_id"
                placeholder="例: 018F0E6F1000"
                required
                type="text"
              />
              <FieldDescription>
                閲覧権を付与するエンドユーザーの public_id を入力します。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="episode_public_id" required>
              エピソード public_id
            </FieldLabel>
            <FieldContent>
              <Input
                id="episode_public_id"
                name="episode_public_id"
                placeholder="例: 018F0E730001"
                required
                type="text"
              />
              <FieldDescription>
                対象エピソードの public_id を入力します。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="expires_at">有効期限</FieldLabel>
            <FieldContent>
              <Input id="expires_at" name="expires_at" type="datetime-local" />
              <FieldDescription>
                未指定の場合は無期限です。失効操作でいつでも取り消せます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="note">メモ</FieldLabel>
            <FieldContent>
              <Textarea
                id="note"
                maxLength={500}
                name="note"
                placeholder="例: レビュー用の限定閲覧"
                rows={3}
              />
            </FieldContent>
          </Field>

          {state && !state.ok ? (
            <FormMessage variant="destructive">{state.message}</FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isPending} type="submit">
              {isPending ? "発行中…" : "チケットを発行"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
