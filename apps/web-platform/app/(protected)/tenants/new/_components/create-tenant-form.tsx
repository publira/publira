import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { AdminDomainPreview } from "#components/admin-domain-preview";
import { ImageDomainPreview } from "#components/image-domain-preview";
import { Message } from "#components/message";
import { TenantDomainCautions } from "#components/tenant-domain-cautions";

import { createTenantAction } from "../_lib/actions";
import { TenantLocalesFields } from "./tenant-locales-fields";

export const CreateTenantForm = () => (
  <ActionForm.Root
    action={createTenantAction}
    className="grid gap-4 sm:max-w-2xl"
  >
    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="platform.tenants.name" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input name="tenant_name" required type="text" />
      </Field.Content>
    </Field.Root>

    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="platform.tenants.domain" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          name="tenant_domain"
          placeholder="tenant-example.example.com"
          required
          type="text"
        />
      </Field.Content>
      <Suspense fallback={<Skeleton className="h-24 bg-muted/70" />}>
        <TenantDomainCautions />
      </Suspense>
    </Field.Root>

    <Field.Root>
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="platform.tenants.admin_domain" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          name="tenant_admin_domain"
          placeholder="admin.tenant-example.example.com"
          type="text"
        />
      </Field.Content>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <AdminDomainPreview showCurrentDomain={false} />
      </Suspense>
    </Field.Root>

    <Field.Root>
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="platform.tenants.image_domain" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input name="tenant_image_domain" type="text" />
      </Field.Content>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <ImageDomainPreview />
      </Suspense>
    </Field.Root>

    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <TenantLocalesFields />
    </Suspense>

    <Field.Root>
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="platform.tenants.initial_admin_emails" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          name="initial_admin_emails"
          placeholder="owner1@example.com, owner2@example.com"
          type="text"
        />
      </Field.Content>
    </Field.Root>

    <div className="mt-2 flex gap-3">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.create" />
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
