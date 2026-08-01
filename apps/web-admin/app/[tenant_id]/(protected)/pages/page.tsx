import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { listPages } from "#lib/page";
import { getTenantId } from "#lib/tenant-id";

import { PageManager } from "./_components/page-manager";

export const metadata: Metadata = {
  title: "ページ",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

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

const PageManagerData = async () => {
  const tenantId = await getTenantId();
  const result = await listPages(tenantId);

  return (
    <PageManager
      initialListErrorMessage={result.ok ? undefined : result.message}
      initialPages={result.pages}
    />
  );
};

export default function PagesPage() {
  return (
    <AdminPage
      description="個別ページの一覧確認、作成、編集画面への遷移を行います。"
      title="ページ"
    >
      <Suspense fallback={<PageManagerSkeleton />}>
        <PageManagerData />
      </Suspense>
    </AdminPage>
  );
}
