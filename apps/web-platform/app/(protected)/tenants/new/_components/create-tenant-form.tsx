"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { ReactNode } from "react";

import { createTenantAction } from "../_lib/actions";

export interface CreateTenantFormCopy {
  adminDomainLabel: ReactNode;
  adminDomainPreview: ReactNode;
  createDraft: ReactNode;
  createPending: ReactNode;
  createSubmit: ReactNode;
  domainCautions: ReactNode;
  domainLabel: ReactNode;
  initialAdminEmailsLabel: ReactNode;
  nameLabel: ReactNode;
}

export const CreateTenantForm = ({ copy }: { copy: CreateTenantFormCopy }) => (
  <ActionForm action={createTenantAction} className="grid gap-4 sm:max-w-2xl">
    {({ isPending, state }) => (
      <>
        <Field>
          <FieldLabel htmlFor="tenant_name" required>
            {copy.nameLabel}
          </FieldLabel>
          <FieldContent>
            <Input id="tenant_name" name="tenant_name" required type="text" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="tenant_domain" required>
            {copy.domainLabel}
          </FieldLabel>
          <FieldContent>
            <Input
              id="tenant_domain"
              name="tenant_domain"
              placeholder="tenant-example.example.com"
              required
              type="text"
            />
          </FieldContent>
          {copy.domainCautions}
        </Field>

        <Field>
          <FieldLabel htmlFor="tenant_admin_domain">
            {copy.adminDomainLabel}
          </FieldLabel>
          <FieldContent>
            <Input
              id="tenant_admin_domain"
              name="tenant_admin_domain"
              placeholder="admin.tenant-example.example.com"
              type="text"
            />
          </FieldContent>
          {copy.adminDomainPreview}
        </Field>

        <Field>
          <FieldLabel htmlFor="initial_admin_emails">
            {copy.initialAdminEmailsLabel}
          </FieldLabel>
          <FieldContent>
            <Input
              id="initial_admin_emails"
              name="initial_admin_emails"
              placeholder="owner1@example.com, owner2@example.com"
              type="text"
            />
          </FieldContent>
        </Field>

        {state && !state.ok ? (
          <FormMessage variant="destructive">{state.message}</FormMessage>
        ) : null}

        <div className="mt-2 flex gap-3">
          <Button disabled={isPending} type="submit">
            {isPending ? copy.createPending : copy.createSubmit}
          </Button>
          <Button disabled={isPending} type="button" variant="outline">
            {copy.createDraft}
          </Button>
        </div>
      </>
    )}
  </ActionForm>
);
