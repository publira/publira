"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useCallback, useState } from "react";

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
            <ClientMessage message="admin.settings.email_change.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.email_change.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel required>
            <ClientMessage message="admin.settings.email_change.current_email" />
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              disabled={isPending}
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
            <ClientMessage message="admin.settings.email_change.new_email" />
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              disabled={isPending}
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
            <ClientMessage message="admin.settings.email_change.current_password" />
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="current-password"
              disabled={isPending}
              name="current_password"
              onChange={handleCurrentPasswordChange}
              placeholder="••••••••"
              required
              type="password"
              value={currentPassword}
            />
            <FieldDescription>
              <ClientMessage message="admin.settings.email_change.password_description" />
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
            <ActionFormIdle>
              <ClientMessage message="admin.settings.email_change.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.settings.email_change.submitting" />
            </ActionFormPending>
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
