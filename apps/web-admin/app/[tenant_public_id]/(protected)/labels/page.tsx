import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "../../../../components/admin-page";
import { listLabels } from "../../../../lib/label";
import { LabelManager } from "./_components/label-manager";

interface LabelPageProps {
  params: Promise<{ tenant_public_id: string }>;
}

export const metadata: Metadata = {
  title: "レーベル",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

const LabelManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const LabelManagerData = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const listResult = await listLabels(tenantPublicId);

  return (
    <LabelManager
      initialLabels={listResult.labels}
      initialListErrorMessage={listResult.ok ? undefined : listResult.message}
    />
  );
};

export default async function LabelPage({ params }: LabelPageProps) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <AdminPage
      description="レーベル一覧の確認と、編集への遷移を行います。"
      title="レーベル"
    >
      <Suspense fallback={<LabelManagerSkeleton />}>
        <LabelManagerData tenantPublicId={tenant_public_id} />
      </Suspense>
    </AdminPage>
  );
}
