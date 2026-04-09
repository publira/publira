"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";

import { AdminDomainPreview } from "#components/admin-domain-preview";
import { TenantDomainCautions } from "#components/tenant-domain-cautions";

import { createTenantAction } from "../_lib/actions";

export const CreateTenantForm = () => (
  <ActionForm action={createTenantAction} className="grid gap-4 sm:max-w-2xl">
    {({ isPending, state }) => (
      <>
        <Field>
          <FieldLabel htmlFor="tenant_name" required>
            テナント名
          </FieldLabel>
          <FieldContent>
            <Input id="tenant_name" name="tenant_name" required type="text" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="tenant_domain" required>
            ドメイン
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
          <TenantDomainCautions mode="create" />
        </Field>

        <Field>
          <FieldLabel htmlFor="tenant_admin_domain">
            管理画面ドメイン
          </FieldLabel>
          <FieldContent>
            <Input
              id="tenant_admin_domain"
              name="tenant_admin_domain"
              placeholder="admin.tenant-example.example.com"
              type="text"
            />
          </FieldContent>
          <AdminDomainPreview adminDomain="" showCurrentDomain={false} />
        </Field>

        <Field>
          <FieldLabel htmlFor="initial_admin_emails">
            初期管理者メール（任意・複数可）
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
            {isPending ? "作成中..." : "作成"}
          </Button>
          <Button disabled={isPending} type="button" variant="outline">
            下書きを保存
          </Button>
        </div>
      </>
    )}
  </ActionForm>
);
