"use client";

import { getMessage, toIntlLocale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
import {
  useActionState,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
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
  const messages = sharedCatalog(locale);
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
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="grid gap-5">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel required>
              {getMessage(messages, "admin.announcements.form.title")}
            </FieldLabel>
            <FieldContent>
              <Input
                maxLength={120}
                name="title"
                placeholder={getMessage(
                  messages,
                  "admin.announcements.form.title_placeholder"
                )}
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>
              {getMessage(messages, "admin.announcements.form.body")}
            </FieldLabel>
            <FieldContent>
              <Textarea
                maxLength={2000}
                name="body"
                placeholder={getMessage(
                  messages,
                  "admin.announcements.form.body_placeholder"
                )}
                required
                rows={5}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.announcements.form.link")}
            </FieldLabel>
            <FieldContent>
              <Input
                name="link_url"
                placeholder={getMessage(
                  messages,
                  "admin.announcements.form.link_placeholder"
                )}
                type="text"
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.announcements.form.link_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>
              {getMessage(messages, "admin.announcements.form.audience")}
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
                  {getMessage(
                    messages,
                    "admin.announcements.form.audience_all"
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={audienceType === "selected"}
                    name="audience_type"
                    onChange={handleAudienceTypeChange}
                    type="radio"
                    value="selected"
                  />
                  {getMessage(
                    messages,
                    "admin.announcements.form.audience_selected"
                  )}
                </label>
              </div>
            </FieldContent>
          </Field>

          {audienceType === "selected" ? (
            <Field>
              <FieldLabel>
                {getMessage(messages, "admin.announcements.form.target_users")}
              </FieldLabel>
              <FieldContent>
                {usersErrorMessage ? (
                  <FormMessage variant="destructive">
                    {usersErrorMessage}
                  </FormMessage>
                ) : null}

                {sortedUsers.length === 0 ? (
                  <FieldDescription>
                    {getMessage(
                      messages,
                      "admin.announcements.form.target_users_unavailable"
                    )}
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
                          {getMessage(
                            messages,
                            "admin.announcements.form.user_option",
                            { id: user.publicId, name: user.name }
                          )}
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
                ? getMessage(messages, "admin.announcements.form.submitting")
                : getMessage(messages, "admin.announcements.form.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
