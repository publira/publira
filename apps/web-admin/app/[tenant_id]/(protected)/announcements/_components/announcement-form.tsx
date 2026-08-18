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
import { useActionState, useCallback, useMemo, useState } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type {
  CreateAnnouncementActionState,
  AnnouncementTargetUser,
} from "../announcement-types";

interface AnnouncementFormProps {
  users: AnnouncementTargetUser[];
  usersErrorMessage?: string;
  action: (
    prevState: CreateAnnouncementActionState,
    formData: FormData
  ) => Promise<CreateAnnouncementActionState>;
}

export const AnnouncementForm = ({
  users,
  usersErrorMessage,
  action,
}: AnnouncementFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [audienceType, setAudienceType] = useState<"all" | "selected">("all");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const sortedUsers = useMemo(
    () => users.toSorted((a, b) => a.name.localeCompare(b.name, "ja")),
    [users]
  );
  const selectedUserIdSet = useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds]
  );

  const handleAudienceTypeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget;
      setAudienceType(value === "selected" ? "selected" : "all");
    },
    []
  );

  const handleUserToggle = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const publicId = event.currentTarget.value;
      setSelectedUserIds((current) => {
        const currentSet = new Set(current);
        if (currentSet.has(publicId)) {
          return current.filter((id) => id !== publicId);
        }
        return [...current, publicId];
      });
    },
    []
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="grid gap-5">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel required>タイトル</FieldLabel>
            <FieldContent>
              <Input
                maxLength={120}
                name="title"
                placeholder="例: 重要なお知らせ"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>本文</FieldLabel>
            <FieldContent>
              <Textarea
                maxLength={2000}
                name="body"
                placeholder="お知らせ本文を入力"
                required
                rows={5}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>リンク先</FieldLabel>
            <FieldContent>
              <Input
                name="link_url"
                placeholder="例: /series/SERIES001"
                type="text"
              />
              <FieldDescription>
                お知らせをタップしたときのリンク先を指定できます。サイト内ページは
                /...、外部サイトは https:// で入力してください。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>配信対象</FieldLabel>
            <FieldContent>
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={audienceType === "all"}
                    name="audience_type"
                    onChange={handleAudienceTypeChange}
                    type="radio"
                    value="all"
                  />
                  全体配信
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={audienceType === "selected"}
                    name="audience_type"
                    onChange={handleAudienceTypeChange}
                    type="radio"
                    value="selected"
                  />
                  指定ユーザー配信
                </label>
              </div>
            </FieldContent>
          </Field>

          {audienceType === "selected" ? (
            <Field>
              <FieldLabel>対象ユーザー</FieldLabel>
              <FieldContent>
                {usersErrorMessage ? (
                  <FormMessage variant="destructive">
                    {usersErrorMessage}
                  </FormMessage>
                ) : null}

                {sortedUsers.length === 0 ? (
                  <FieldDescription>
                    対象ユーザー一覧を取得できないため、指定ユーザー配信は利用できません。
                  </FieldDescription>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border/70 p-3">
                    <div className="grid gap-2">
                      {sortedUsers.map((user) => (
                        <label
                          className="flex items-center gap-2 text-sm"
                          key={user.publicId}
                        >
                          <input
                            checked={selectedUserIdSet.has(user.publicId)}
                            onChange={handleUserToggle}
                            type="checkbox"
                            value={user.publicId}
                          />
                          {user.name} ({user.publicId})
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {selectedUserIds.map((publicId) => (
                  <input
                    key={publicId}
                    name="target_user_public_ids"
                    type="hidden"
                    value={publicId}
                  />
                ))}
              </FieldContent>
            </Field>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isPending} type="submit">
              {isPending ? "送信中..." : "お知らせを配信"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
