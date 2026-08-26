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
import type { ChangeEvent, ReactNode } from "react";
import { useActionState, useCallback, useState } from "react";

import type { PlatformEmailChangeActionState } from "../../_lib/actions";

export interface EmailChangeFormCopy {
  currentEmailLabel: ReactNode;
  description: ReactNode;
  newEmailLabel: ReactNode;
  passwordHelp: ReactNode;
  passwordLabel: ReactNode;
  pendingLabel: ReactNode;
  submitLabel: ReactNode;
  title: ReactNode;
}

interface EmailChangeFormProps {
  action: (
    prevState: PlatformEmailChangeActionState,
    formData: FormData
  ) => Promise<PlatformEmailChangeActionState>;
  copy: EmailChangeFormCopy;
}

export const EmailChangeForm = ({ action, copy }: EmailChangeFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [currentEmail, setCurrentEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const handleCurrentEmailChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setCurrentEmail(event.target.value);
    },
    []
  );

  const handleNewEmailChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setNewEmail(event.target.value);
    },
    []
  );

  const handleCurrentPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setCurrentPassword(event.target.value);
    },
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="current_email" required>
              {copy.currentEmailLabel}
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                id="current_email"
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
            <FieldLabel htmlFor="new_email" required>
              {copy.newEmailLabel}
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="email"
                id="new_email"
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
            <FieldLabel htmlFor="current_password" required>
              {copy.passwordLabel}
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="current-password"
                id="current_password"
                name="current_password"
                onChange={handleCurrentPasswordChange}
                placeholder="••••••••"
                required
                type="password"
                value={currentPassword}
              />
              <FieldDescription>{copy.passwordHelp}</FieldDescription>
            </FieldContent>
          </Field>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {isPending ? copy.pendingLabel : copy.submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
