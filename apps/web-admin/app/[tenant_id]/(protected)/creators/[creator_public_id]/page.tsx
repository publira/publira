import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
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

const EditCreatorFormData = async ({
  creatorPublicId,
}: {
  creatorPublicId: string;
}) => {
  const tenantId = await getTenantId();
  const result = await getCreator({
    publicId: creatorPublicId,
    tenantId,
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
    />
  );
};

const EditCreatorPage = async ({ params }: EditCreatorPageProps) => {
  const { creator_public_id } = await params;
  guardPlaceholder(creator_public_id);

  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/creators" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="著者の情報を編集します。"
      title="著者編集"
    >
      <FlashToast title="著者を作成しました。" />
      <Suspense fallback={<EditCreatorFormSkeleton />}>
        <EditCreatorFormData creatorPublicId={creator_public_id} />
      </Suspense>
    </AdminPage>
  );
};

export default EditCreatorPage;
