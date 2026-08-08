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
import { DEFAULT_TIME_ZONE, fromDateTimeLocalValue } from "@publira/utils";
import { useActionState, useCallback, useRef } from "react";

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
  const expiresAtIsoRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      // datetime-local is a zone-free wall clock. Resolve it against the admin
      // UI's display zone — not the browser's, which would make the same input
      // mean different instants for operators travelling or set to another TZ —
      // and post an absolute instant so the server cannot reinterpret it.
      const form = event.currentTarget;
      const localInput = form.elements.namedItem(
        "expires_at_local"
      ) as HTMLInputElement | null;
      const isoInput = expiresAtIsoRef.current;
      if (!isoInput) {
        return;
      }
      // Empty / unparseable values become "", which the server action rejects.
      isoInput.value = fromDateTimeLocalValue(
        localInput?.value ?? "",
        DEFAULT_TIME_ZONE
      );
    },
    []
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          action={formAction}
          className="grid gap-5"
          onSubmit={handleSubmit}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input
            defaultValue=""
            name="expires_at"
            ref={expiresAtIsoRef}
            type="hidden"
          />

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
            <FieldLabel htmlFor="expires_at_local">有効期限</FieldLabel>
            <FieldContent>
              <Input
                id="expires_at_local"
                name="expires_at_local"
                type="datetime-local"
              />
              <FieldDescription>
                未指定の場合は無期限です。日本時間（Asia/Tokyo）で解釈し、送信時に
                ISO 8601（UTC）へ変換します。失効操作でいつでも取り消せます。
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
