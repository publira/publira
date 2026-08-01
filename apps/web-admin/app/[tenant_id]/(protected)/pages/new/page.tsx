import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";

import { PageForm } from "../_components/page-form";
import { createPageAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "ページ新規作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const PageFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NewPageFormData = () => (
  <PageForm action={createPageAction} mode="create" />
);

export default function NewPagePage() {
  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/pages" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="新しい固定ページを作成します。作成後は編集画面で Markdown と公開設定を管理できます。"
      title="ページ新規作成"
    >
      <Suspense fallback={<PageFormSkeleton />}>
        <NewPageFormData />
      </Suspense>
    </AdminPage>
  );
}
