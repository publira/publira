import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { PageForm } from "../_components/page-form";
import { createPageAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.pages.new_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const PageFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const NewPageFormData = () => (
  <PageForm action={createPageAction} mode="create" />
);

const NewPagePage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.pages.new_title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.pages.new_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/pages" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.pages.back_to_list" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<PageFormSkeleton />}>
        <NewPageFormData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NewPagePage;
