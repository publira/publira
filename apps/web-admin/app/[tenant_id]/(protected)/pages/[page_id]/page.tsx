import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSections,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPage, listPageVersions } from "#lib/page";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PageWorkspace } from "../_components/page-workspace";
import {
  publishVersionAction,
  rollbackVersionAction,
  savePageAction,
  unpublishPageAction,
} from "../_lib/actions";

interface EditPagePageProps {
  params: Promise<{
    page_id: string;
    tenant_id: string;
  }>;
}

const editPageParamsSchema = z.object({
  page_id: routeParamString(),
});

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.pages.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "page_id");

const PageWorkspaceSkeleton = () => (
  <AdminSections>
    <Skeleton className="h-[520px]" />
    <Skeleton className="h-72" />
  </AdminSections>
);

const PageLoadError = ({ message }: { message: string }) => (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>
        <Message message="admin.pages.detail_error" />
      </SectionErrorTitle>
      <SectionErrorDescription>{message}</SectionErrorDescription>
    </SectionErrorHeading>
    <SectionErrorActions>
      <LinkButton render={<Link href="/pages" />} variant="outline">
        <Message message="admin.pages.back_to_list" />
      </LinkButton>
    </SectionErrorActions>
  </SectionError>
);

const PageWorkspaceData = async ({
  params,
}: Pick<EditPagePageProps, "params">) => {
  const parsedParams = parseRouteParams(editPageParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  const { page_id: pageId } = parsedParams;

  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [pageResult, versionsResult, timeZone] = await Promise.all([
    getPage({ pageId, tenantId }, locale),
    listPageVersions({ pageId, tenantId }, locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!pageResult.ok) {
    if (pageResult.notFound) {
      // Missing, another tenant's page, or an id the URL could never address —
      // never told apart. Renders `(protected)/not-found.tsx` inside the
      // console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(pageResult);

    return <PageLoadError message={pageResult.message} />;
  }

  if (!versionsResult.ok && versionsResult.versions.length === 0) {
    await redirectToLoginIfSessionRejected(versionsResult);

    return <PageLoadError message={versionsResult.message} />;
  }

  return (
    <PageWorkspace
      initialPage={pageResult.page}
      initialVersions={versionsResult.versions}
      publishAction={publishVersionAction}
      rollbackAction={rollbackVersionAction}
      saveAction={savePageAction}
      timeZone={timeZone}
      unpublishAction={unpublishPageAction}
    />
  );
};

const EditPagePage = ({ params }: EditPagePageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Message message="admin.pages.edit_title" />
        </AdminPageTitle>
        <AdminPageDescription>
          <Message message="admin.pages.edit_description" />
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
      <FlashToast message="admin.pages.created" />
      <FlashToast keyName="saved" message="admin.pages.saved" />
      <FlashToast keyName="published" message="admin.pages.published_success" />
      <FlashToast keyName="unpublished" message="admin.pages.unpublished" />
      <FlashToast keyName="rolled_back" message="admin.pages.rolled_back" />

      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.pages.detail_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<PageWorkspaceSkeleton />}>
          <PageWorkspaceData params={params} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default EditPagePage;
