import { LinkButton } from "@publira/ui-components/button";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "../../../../../components/admin-page";
import { CreatorForm } from "../_components/creator-form";
import { createCreatorAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "クリエイター新規作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

const NewCreatorFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-32 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NewCreatorFormData = async ({
  params,
}: PageProps<"/[tenant_public_id]/creators/new">) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <CreatorForm
      action={createCreatorAction}
      mode="create"
      tenantPublicId={tenant_public_id}
    />
  );
};

export default function NewCreatorPage(
  props: PageProps<"/[tenant_public_id]/creators/new">
) {
  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/creators" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="新しいクリエイターを登録します。"
      title="クリエイター新規作成"
    >
      <Suspense fallback={<NewCreatorFormSkeleton />}>
        <NewCreatorFormData {...props} />
      </Suspense>
    </AdminPage>
  );
}
