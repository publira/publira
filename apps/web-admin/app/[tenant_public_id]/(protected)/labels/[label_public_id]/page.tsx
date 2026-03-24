import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "../../../../../components/admin-page";
import { FlashToast } from "../../../../../components/flash-toast";
import { getLabel } from "../../../../../lib/label";
import { LabelForm } from "../_components/label-form";
import { updateLabelAction } from "../_lib/actions";

interface EditLabelPageProps {
  params: Promise<{
    label_public_id: string;
    tenant_public_id: string;
  }>;
}

export const metadata: Metadata = {
  title: "レーベル編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "label_public_id");

const EditLabelFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const EditLabelFormData = async ({ params }: EditLabelPageProps) => {
  const { label_public_id, tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  guardPlaceholder(label_public_id);

  const result = await getLabel({
    publicId: label_public_id,
    tenantPublicId: tenant_public_id,
  });

  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <FormMessage variant="destructive">{result.message}</FormMessage>
        <div>
          <LinkButton render={<Link href="/labels" />} variant="outline">
            一覧へ戻る
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <LabelForm
      action={updateLabelAction}
      initialLabel={result.label}
      mode="update"
      tenantPublicId={tenant_public_id}
    />
  );
};

export default function EditLabelPage(props: EditLabelPageProps) {
  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/labels" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="レーベル情報を編集します。"
      title="レーベル編集"
    >
      <FlashToast title="レーベルを作成しました。" />
      <Suspense fallback={<EditLabelFormSkeleton />}>
        <EditLabelFormData {...props} />
      </Suspense>
    </AdminPage>
  );
}
