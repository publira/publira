import { LinkButton } from "@publira/ui-components/button";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getCreator } from "#lib/creator";
import { getTenantId } from "#lib/tenant-id";

import { CreatorForm } from "../_components/creator-form";
import { updateCreatorAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "著者編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "creator_public_id");

const EditCreatorFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-32 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

interface EditCreatorPageProps {
  params: Promise<{
    creator_public_id: string;
    tenant_id: string;
  }>;
}

const editCreatorParamsSchema = z.object({
  creator_public_id: routeParamString(),
});

const EditCreatorFormData = async ({
  params,
}: Pick<EditCreatorPageProps, "params">) => {
  const parsedParams = parseRouteParams(editCreatorParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  const { creator_public_id: creatorPublicId } = parsedParams;

  const tenantId = await getTenantId();
  const result = await getCreator({
    publicId: creatorPublicId,
    tenantId,
  });

  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's creator — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError
        actions={
          <LinkButton render={<Link href="/creators" />} variant="outline">
            一覧へ戻る
          </LinkButton>
        }
        description={result.message}
        title="著者を表示できませんでした"
      />
    );
  }

  return (
    <CreatorForm
      action={updateCreatorAction}
      initialCreator={result.creator}
      mode="update"
    />
  );
};

const EditCreatorPage = ({ params }: EditCreatorPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>著者編集</AdminPageTitle>
        <AdminPageDescription>著者の情報を編集します。</AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/creators" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast title="著者を作成しました。" />
      <SectionErrorBoundary
        description={
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.common.retry_later" />
          </Suspense>
        }
        digestLabel={
          <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
            <Message message="admin.common.error_id" />
          </Suspense>
        }
        retryLabel={
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.common.retry" />
          </Suspense>
        }
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.creators.detail_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<EditCreatorFormSkeleton />}>
          <EditCreatorFormData params={params} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default EditCreatorPage;
