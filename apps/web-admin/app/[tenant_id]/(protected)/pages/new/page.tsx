import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  TenantEditorRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { isSignedInTenantEditor } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantLocales } from "#lib/tenant-locales";

import { PageForm } from "../_components/page-form";
import { createPageAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isEditor] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantEditor(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isEditor ? t("admin.pages.new_title") : t("admin.not_found.title"),
  };
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

const NewPageFormData = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const localesResult = await getTenantLocales(tenantId, locale);

  return (
    <PageForm
      action={createPageAction}
      defaultLocale={localesResult.ok ? localesResult.defaultLocale : undefined}
      tenantId={tenantId}
    />
  );
};

const NewPagePage = () => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantEditorRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.pages.new_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.pages.new_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton render={<Link href="/pages" />} variant="outline">
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.pages.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <Suspense fallback={<PageFormSkeleton />}>
            <NewPageFormData />
          </Suspense>
        </ConsolePage.Content>
      </TenantEditorRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default NewPagePage;
