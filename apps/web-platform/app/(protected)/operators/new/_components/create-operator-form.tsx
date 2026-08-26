"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";
import type { ReactNode } from "react";

import { createOperatorAction } from "../_lib/actions";

/**
 * Copy arrives as already-rendered nodes, not strings: each one carries its own
 * `<Suspense>` boundary, so this form is part of the static shell and only the
 * labels stream in.
 */
export interface CreateOperatorFormCopy {
  cancelLabel: ReactNode;
  emailLabel: ReactNode;
  nameLabel: ReactNode;
  pendingLabel: ReactNode;
  roleLabel: ReactNode;
  submitLabel: ReactNode;
}

export const CreateOperatorForm = ({
  copy,
  roleSelect,
}: {
  copy: CreateOperatorFormCopy;
  /** Localized role options; `placeholder` cannot stream as a node. */
  roleSelect: ReactNode;
}) => (
  <ActionForm action={createOperatorAction} className="grid gap-4 sm:max-w-2xl">
    {({ isPending, state }) => (
      <>
        <Field>
          <FieldLabel htmlFor="operator_name" required>
            {copy.nameLabel}
          </FieldLabel>
          <FieldContent>
            <Input
              id="operator_name"
              name="operator_name"
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="operator_email" required>
            {copy.emailLabel}
          </FieldLabel>
          <FieldContent>
            <Input
              id="operator_email"
              name="operator_email"
              placeholder="operator@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="operator_role" required>
            {copy.roleLabel}
          </FieldLabel>
          <FieldContent>{roleSelect}</FieldContent>
        </Field>

        {state && !state.ok ? (
          <FormMessage variant="destructive">{state.message}</FormMessage>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button disabled={isPending} type="submit">
            {isPending ? copy.pendingLabel : copy.submitLabel}
          </Button>
          <LinkButton render={<Link href="/operators" />} variant="outline">
            {copy.cancelLabel}
          </LinkButton>
        </div>
      </>
    )}
  </ActionForm>
);
