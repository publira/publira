"use client";

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
import { Suspense, useActionState, useCallback, useState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import type { EmailChangeActionState } from "../settings-types";

interface EmailChangeFormProps {
  action: (
    prevState: EmailChangeActionState,
    formData: FormData
  ) => Promise<EmailChangeActionState>;
}

export const EmailChangeForm = ({ action }: EmailChangeFormProps) => {
  const t = useAdminMessages();
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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.email_change.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.email_change.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.email_change.current_email" />
            </Suspense>
          </FieldLabel>
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
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.email_change.new_email" />
            </Suspense>
          </FieldLabel>
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
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.email_change.current_password" />
            </Suspense>
          </FieldLabel>
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
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.settings.email_change.password_description" />
              </Suspense>
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
            {isPending
              ? t("admin.settings.email_change.submitting")
              : t("admin.settings.email_change.submit")}
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
