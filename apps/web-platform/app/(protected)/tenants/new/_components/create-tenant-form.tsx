import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { AdminDomainPreview } from "#components/admin-domain-preview";
import { Message } from "#components/message";
import { TenantDomainCautions } from "#components/tenant-domain-cautions";

import { createTenantAction } from "../_lib/actions";
import { TenantDefaultLocaleSelect } from "./tenant-default-locale-select";

export const CreateTenantForm = () => (
  <ActionForm action={createTenantAction} className="grid gap-4 sm:max-w-2xl">
    <Field>
      <FieldLabel htmlFor="tenant_name" required>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="platform.tenants.name" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input id="tenant_name" name="tenant_name" required type="text" />
      </FieldContent>
    </Field>

    <Field>
      <FieldLabel htmlFor="tenant_domain" required>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="platform.tenants.domain" />
        </Suspense>
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
      <Suspense
        fallback={<div className="h-24 animate-pulse rounded bg-muted/70" />}
      >
        <TenantDomainCautions />
      </Suspense>
    </Field>

    <Field>
      <FieldLabel htmlFor="tenant_admin_domain">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="platform.tenants.admin_domain" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          id="tenant_admin_domain"
          name="tenant_admin_domain"
          placeholder="admin.tenant-example.example.com"
          type="text"
        />
      </FieldContent>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <AdminDomainPreview showCurrentDomain={false} />
      </Suspense>
    </Field>

    <Field>
      <FieldLabel htmlFor="tenant_default_locale" required>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="platform.tenants.default_locale" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Suspense fallback={<Skeleton className="h-10 w-full" />}>
          <TenantDefaultLocaleSelect />
        </Suspense>
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.tenants.default_locale_help" />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>

    <Field>
      <FieldLabel htmlFor="initial_admin_emails">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="platform.tenants.initial_admin_emails" />
        </Suspense>
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

    <div className="mt-2 flex gap-3">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.create" />
        </Suspense>
      </ActionFormSubmit>
      <Button type="button" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="platform.tenants.create_draft" />
        </Suspense>
      </Button>
    </div>
  </ActionForm>
);
