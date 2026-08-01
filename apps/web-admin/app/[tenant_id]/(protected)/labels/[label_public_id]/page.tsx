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
import { getLabel } from "#lib/label";
import { getTenantId } from "#lib/tenant-id";

import { LabelEyeCatchForm } from "../_components/label-eye-catch-form";
import { LabelForm } from "../_components/label-form";
import { LabelTabNav } from "../_components/label-tab-nav";
import { updateLabelAction } from "../_lib/actions";

interface EditLabelPageProps {
  params: Promise<{
    label_public_id: string;
    tenant_id: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

export const metadata: Metadata = {
  title: "レーベル編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "label_public_id");

const EditLabelFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const EditLabelFormData = async ({
  activeTab,
  labelPublicId,
}: {
  activeTab: "basic" | "eye-catch";
  labelPublicId: string;
}) => {
  const tenantId = await getTenantId();
  const result = await getLabel({
    publicId: labelPublicId,
    tenantId,
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

  if (activeTab === "eye-catch") {
    return (
      <LabelEyeCatchForm
        action={updateLabelAction}
        initialLabel={result.label}
      />
    );
  }

  return (
    <LabelForm
      action={updateLabelAction}
      initialLabel={result.label}
      mode="update"
    />
  );
};

export default async function EditLabelPage({
  params,
  searchParams,
}: EditLabelPageProps) {
  const { label_public_id } = await params;
  const { tab } = await searchParams;

  guardPlaceholder(label_public_id);

  const activeTab = tab === "eye-catch" ? "eye-catch" : "basic";
  const pageTitle =
    activeTab === "eye-catch" ? "レーベルのアイキャッチを編集" : "レーベル編集";
  const pageDescription =
    activeTab === "eye-catch"
      ? "アイキャッチ画像の差し替え・削除を行います。"
      : "レーベル情報を編集します。";

  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/labels" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description={pageDescription}
      title={pageTitle}
    >
      <FlashToast title="レーベルを作成しました。" />
      <div className="grid gap-6">
        <LabelTabNav current={activeTab} labelId={label_public_id} />
        <Suspense fallback={<EditLabelFormSkeleton />}>
          <EditLabelFormData
            activeTab={activeTab}
            labelPublicId={label_public_id}
          />
        </Suspense>
      </div>
    </AdminPage>
  );
}
