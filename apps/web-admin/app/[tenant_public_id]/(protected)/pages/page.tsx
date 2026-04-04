import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { listPages } from "#lib/page";

import { PageManager } from "./_components/page-manager";

interface PagesPageProps {
  params: Promise<{ tenant_public_id: string }>;
}

export const metadata: Metadata = {
  title: "ページ",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

const PageManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const PageManagerData = async ({ tenantPublicId }: { tenantPublicId: string }) => {
  const result = await listPages(tenantPublicId);

  return (
    <PageManager
      initialListErrorMessage={result.ok ? undefined : result.message}
      initialPages={result.pages}
    />
  );
};

export default async function PagesPage({ params }: PagesPageProps) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <AdminPage
      description="個別ページの一覧確認、作成、編集画面への遷移を行います。"
      title="ページ"
    >
      <Suspense fallback={<PageManagerSkeleton />}>
        <PageManagerData tenantPublicId={tenant_public_id} />
      </Suspense>
    </AdminPage>
  );
}