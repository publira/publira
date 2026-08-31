"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
import { useActionState, useCallback, useContext, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import type { EmailChangeActionState } from "../settings-types";

interface EmailChangeFormProps {
  action: (
    prevState: EmailChangeActionState,
    formData: FormData
  ) => Promise<EmailChangeActionState>;
}

export const EmailChangeForm = ({ action }: EmailChangeFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
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
        <CardTitle>
          {getMessage(messages, "admin.settings.email_change.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.email_change.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel required>
              {getMessage(
                messages,
                "admin.settings.email_change.current_email"
              )}
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
              {getMessage(messages, "admin.settings.email_change.new_email")}
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
              {getMessage(
                messages,
                "admin.settings.email_change.current_password"
              )}
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
                {getMessage(
                  messages,
                  "admin.settings.email_change.password_description"
                )}
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
                ? getMessage(messages, "admin.settings.email_change.submitting")
                : getMessage(messages, "admin.settings.email_change.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
