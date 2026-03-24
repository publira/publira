import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "../../../../../../components/admin-page";
import { getCreator } from "../../../../../../lib/creator";
import { CreatorForm } from "../../_components/creator-form";
import { updateCreatorAction } from "../../_lib/actions";

export const metadata: Metadata = {
  title: "クリエイター編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "creator_public_id");

const EditCreatorFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-32 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const EditCreatorFormData = async ({
  params,
}: PageProps<"/[tenant_public_id]/creators/[creator_public_id]/edit">) => {
  const { creator_public_id, tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  guardPlaceholder(creator_public_id);

  const result = await getCreator({
    publicId: creator_public_id,
    tenantPublicId: tenant_public_id,
  });

  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <FormMessage variant="destructive">{result.message}</FormMessage>
        <div>
          <LinkButton render={<Link href="/creators" />} variant="outline">
            一覧へ戻る
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <CreatorForm
      action={updateCreatorAction}
      initialCreator={result.creator}
      mode="update"
      tenantPublicId={tenant_public_id}
    />
  );
};

export default function EditCreatorPage(
  props: PageProps<"/[tenant_public_id]/creators/[creator_public_id]/edit">
) {
  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/creators" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="クリエイターの情報を編集します。"
      title="クリエイター編集"
    >
      <Suspense fallback={<EditCreatorFormSkeleton />}>
        <EditCreatorFormData {...props} />
      </Suspense>
    </AdminPage>
  );
}
