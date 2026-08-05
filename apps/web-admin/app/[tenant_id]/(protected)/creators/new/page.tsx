import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";

import { CreatorForm } from "../_components/creator-form";
import { createCreatorAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "著者新規作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewCreatorFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-32 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NewCreatorFormData = () => (
  <CreatorForm action={createCreatorAction} mode="create" />
);

const NewCreatorPage = () => (
  <AdminPage
    actions={
      <LinkButton render={<Link href="/creators" />} variant="outline">
        一覧へ戻る
      </LinkButton>
    }
    description="新しい著者を登録します。"
    title="著者新規作成"
  >
    <Suspense fallback={<NewCreatorFormSkeleton />}>
      <NewCreatorFormData />
    </Suspense>
  </AdminPage>
);

export default NewCreatorPage;
