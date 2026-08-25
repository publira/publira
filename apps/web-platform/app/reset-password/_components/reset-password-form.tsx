"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";
import type { ReactNode } from "react";

import { requestPasswordResetAction } from "../_lib/actions";

/** Nodes rather than strings; see `LoginFormCopy` for why. */
export interface ResetPasswordFormCopy {
  emailLabel: ReactNode;
  pendingLabel: ReactNode;
  submitLabel: ReactNode;
  toLogin: ReactNode;
}

export const ResetPasswordForm = ({
  copy,
}: {
  copy: ResetPasswordFormCopy;
}) => (
  <>
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <ActionForm
        action={requestPasswordResetAction}
        className="space-y-4"
        pendingLabel={copy.pendingLabel}
        submitClassName="mt-2 w-full"
        submitLabel={copy.submitLabel}
      >
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
      </ActionForm>
    </div>

    <div className="mt-4 text-center text-sm">
      <Link className="font-medium text-primary hover:underline" href="/login">
        {copy.toLogin}
      </Link>
    </div>
  </>
);
