"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";

import { loginAction } from "../_lib/actions";

/**
 * The screen's copy, resolved on the server. A Client Component never loads a
 * catalog itself — that would ship both locales to the browser.
 */
export interface LoginFormCopy {
  emailLabel: string;
  forgotPassword: string;
  passwordLabel: string;
  pendingLabel: string;
  resetDone: string;
  sessionRevoked: string;
  submitLabel: string;
}

export const LoginForm = ({
  copy,
  nextPath,
  resetDone,
  sessionRevoked,
}: {
  copy: LoginFormCopy;
  nextPath?: string;
  resetDone?: boolean;
  sessionRevoked?: boolean;
}) => (
  <>
    <ActionForm
      action={loginAction}
      className="space-y-4"
      pendingLabel={copy.pendingLabel}
      submitClassName="mt-2 w-full"
      submitLabel={copy.submitLabel}
    >
      <input name="next" type="hidden" value={nextPath} />

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

      {sessionRevoked ? (
        <FormMessage variant="destructive">{copy.sessionRevoked}</FormMessage>
      ) : null}

      {resetDone ? (
        <FormMessage variant="success">{copy.resetDone}</FormMessage>
      ) : null}
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
