"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";
import type { ReactNode } from "react";

import { loginAction } from "../_lib/actions";

/**
 * Copy arrives as already-rendered nodes, not strings: each one carries its own
 * `<Suspense>` boundary, so this form is part of the static shell and only the
 * labels stream in.
 */
export interface LoginFormCopy {
  emailLabel: ReactNode;
  forgotPassword: ReactNode;
  passwordLabel: ReactNode;
  pendingLabel: ReactNode;
  submitLabel: ReactNode;
}

export const LoginForm = ({
  copy,
  flash,
  nextField,
}: {
  copy: LoginFormCopy;
  /** Flash messages from the query. Renders nothing until it resolves. */
  flash: ReactNode;
  /** Hidden `next` field from the query. Nothing to show while it resolves. */
  nextField: ReactNode;
}) => (
  <>
    <ActionForm
      action={loginAction}
      className="space-y-4"
      pendingLabel={copy.pendingLabel}
      submitClassName="mt-2 w-full"
      submitLabel={copy.submitLabel}
    >
      {nextField}

      <Field>
        <FieldLabel htmlFor="email" required>
          {copy.emailLabel}
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="email"
            id="email"
            name="email"
            placeholder="operator@example.com"
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
            autoComplete="current-password"
            id="password"
            name="password"
            placeholder="••••••••"
            required
            type="password"
          />
        </FieldContent>
      </Field>

      {flash}
    </ActionForm>

    <div className="mt-4 text-center text-sm">
      <Link
        className="font-medium text-primary hover:underline"
        href="/reset-password"
      >
        {copy.forgotPassword}
      </Link>
    </div>
  </>
);
