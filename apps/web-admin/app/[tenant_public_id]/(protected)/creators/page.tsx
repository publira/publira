import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "../../../../components/admin-page";
import { listCreators } from "../../../../lib/creator";
import { CreatorManager } from "./_components/creator-manager";

export const metadata: Metadata = {
  title: "著者",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

const CreatorManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const CreatorManagerData = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const listResult = await listCreators(tenantPublicId);

  return (
    <CreatorManager
      initialListErrorMessage={listResult.ok ? undefined : listResult.message}
      initialCreators={listResult.creators}
    />
  );
};

export default async function CreatorPage({
  params,
}: PageProps<"/[tenant_public_id]/creators">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <AdminPage
      description="著者一覧の確認と、編集への遷移を行います。"
      title="著者"
    >
      <Suspense fallback={<CreatorManagerSkeleton />}>
        <CreatorManagerData tenantPublicId={tenant_public_id} />
      </Suspense>
    </AdminPage>
  );
}
