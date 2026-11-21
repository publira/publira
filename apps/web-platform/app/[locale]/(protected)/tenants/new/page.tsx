import * as ConsolePage from "@publira/layouts/admin/console-page";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import { CreateTenantForm } from "./_components/create-tenant-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("platform.tenants.create_title") };
};

/** Stands in for the form, which waits for its language fields as a whole. */
const CreateTenantFormSkeleton = () => (
  <div className="grid gap-4 sm:max-w-2xl">
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-64 w-full" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-9 w-24" />
  </div>
);

const TenantNewPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.tenants.create_heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.tenants.create_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<CreateTenantFormSkeleton />}>
        <CreateTenantForm />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default TenantNewPage;
