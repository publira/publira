"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { ReactNode } from "react";

import { setupAction } from "../_lib/actions";

/** Nodes rather than strings; see `LoginFormCopy` for why. */
export interface SetupFormCopy {
  confirmPasswordLabel: ReactNode;
  emailLabel: ReactNode;
  nameLabel: ReactNode;
  passwordLabel: ReactNode;
  pendingLabel: ReactNode;
  submitLabel: ReactNode;
}

export const SetupForm = ({
  copy,
  nameInput,
}: {
  copy: SetupFormCopy;
  /** Carries a localized `placeholder`, which an attribute cannot stream. */
  nameInput: ReactNode;
}) => (
  <ActionForm
    action={setupAction}
    className="space-y-4"
    pendingLabel={copy.pendingLabel}
    submitClassName="mt-2 w-full"
    submitLabel={copy.submitLabel}
  >
    <Field>
      <FieldLabel htmlFor="name" required>
        {copy.nameLabel}
      </FieldLabel>
      <FieldContent>{nameInput}</FieldContent>
    </Field>

    <Field>
      <FieldLabel htmlFor="email" required>
        {copy.emailLabel}
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="email"
          id="email"
          name="email"
          placeholder="admin@example.com"
          required
          type="email"
        />
      </FieldContent>
    </Field>

    <Field>
      <FieldLabel htmlFor="password" required>
        {copy.passwordLabel}
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="new-password"
          id="password"
          name="password"
          placeholder="••••••••"
          required
          type="password"
        />
      </FieldContent>
    </Field>

    <Field>
      <FieldLabel htmlFor="confirmPassword" required>
        {copy.confirmPasswordLabel}
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="new-password"
          id="confirmPassword"
          name="confirmPassword"
          placeholder="••••••••"
          required
          type="password"
        />
      </FieldContent>
    </Field>
  </ActionForm>
);
