import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
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

const resolveActiveTab = async (
  searchParams: EditLabelPageProps["searchParams"]
): Promise<"basic" | "eye-catch"> => {
  const { tab } = await searchParams;
  return tab === "eye-catch" ? "eye-catch" : "basic";
};

const EditLabelTitle = async ({
  searchParams,
}: Pick<EditLabelPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch"
    ? "レーベルのアイキャッチを編集"
    : "レーベル編集";
};

const EditLabelDescription = async ({
  searchParams,
}: Pick<EditLabelPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch"
    ? "アイキャッチ画像の差し替え・削除を行います。"
    : "レーベル情報を編集します。";
};

const EditLabelTabNav = async ({
  params,
  searchParams,
}: EditLabelPageProps) => {
  const [{ label_public_id: labelPublicId }, activeTab] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
  ]);
  guardPlaceholder(labelPublicId);

  return <LabelTabNav current={activeTab} labelId={labelPublicId} />;
};

const EditLabelFormData = async ({
  params,
  searchParams,
}: EditLabelPageProps) => {
  const [{ label_public_id: labelPublicId }, activeTab, tenantId] =
    await Promise.all([params, resolveActiveTab(searchParams), getTenantId()]);
  guardPlaceholder(labelPublicId);

  const result = await getLabel({
    publicId: labelPublicId,
    tenantId,
  });

  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's label — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

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

const TextLineSkeleton = ({ className }: { className: string }) => (
  <span
    aria-hidden
    className={`inline-block animate-pulse rounded bg-muted align-middle ${className}`}
  />
);

const EditLabelPage = ({ params, searchParams }: EditLabelPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Suspense fallback={<TextLineSkeleton className="h-7 w-64" />}>
            <EditLabelTitle searchParams={searchParams} />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<TextLineSkeleton className="h-4 w-72" />}>
            <EditLabelDescription searchParams={searchParams} />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/labels" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast title="レーベルを作成しました。" />
      <div className="grid gap-6">
        <Suspense fallback={<TextLineSkeleton className="h-9 w-56" />}>
          <EditLabelTabNav params={params} searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={<EditLabelFormSkeleton />}>
          <EditLabelFormData params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default EditLabelPage;
