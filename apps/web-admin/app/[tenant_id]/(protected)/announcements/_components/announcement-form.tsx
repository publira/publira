"use client";

import { toIntlLocale } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import {
  Suspense,
  useActionState,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import {
  AdminLocaleContext,
  useAdminMessages,
} from "#components/admin-locale-context";
import { ClientMessage } from "#components/client-message";
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
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [audienceType, setAudienceType] = useState<"all" | "selected">("all");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const intlLocale = toIntlLocale(locale);
  const sortedUsers = useMemo(
    () => users.toSorted((a, b) => a.name.localeCompare(b.name, intlLocale)),
    [intlLocale, users]
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
    <form action={formAction} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ClientMessage message="admin.announcements.form.title" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            maxLength={120}
            name="title"
            placeholder={t("admin.announcements.form.title_placeholder")}
            required
            type="text"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ClientMessage message="admin.announcements.form.body" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Textarea
            maxLength={2000}
            name="body"
            placeholder={t("admin.announcements.form.body_placeholder")}
            required
            rows={5}
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ClientMessage message="admin.announcements.form.link" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            name="link_url"
            placeholder={t("admin.announcements.form.link_placeholder")}
            type="text"
          />
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.announcements.form.link_description" />
            </Suspense>
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ClientMessage message="admin.announcements.form.audience" />
          </Suspense>
        </FieldLabel>
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
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.announcements.form.audience_all" />
              </Suspense>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={audienceType === "selected"}
                name="audience_type"
                onChange={handleAudienceTypeChange}
                type="radio"
                value="selected"
              />
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.announcements.form.audience_selected" />
              </Suspense>
            </label>
          </div>
        </FieldContent>
      </Field>

      {audienceType === "selected" ? (
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.announcements.form.target_users" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            {usersErrorMessage ? (
              <FormMessage variant="destructive">
                {usersErrorMessage}
              </FormMessage>
            ) : null}

            {sortedUsers.length === 0 ? (
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <ClientMessage message="admin.announcements.form.target_users_unavailable" />
                </Suspense>
              </FieldDescription>
            ) : (
              <div className="max-h-72 overflow-y-auto border border-border p-3">
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
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <ClientMessage
                          message="admin.announcements.form.user_option"
                          values={{ id: user.publicId, name: user.name }}
                        />
                      </Suspense>
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
          {isPending
            ? t("admin.announcements.form.submitting")
            : t("admin.announcements.form.submit")}
        </Button>
      </div>
    </form>
  );
};
