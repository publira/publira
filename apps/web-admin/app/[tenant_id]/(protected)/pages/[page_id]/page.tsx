import { LinkButton } from "@publira/ui-components/button";
import { SectionError } from "@publira/ui-components/section-error";
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
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getPage, listPageVersions } from "#lib/page";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PageWorkspace } from "../_components/page-workspace";
import {
  createDraftVersionAction,
  publishVersionAction,
  rollbackVersionAction,
  updatePageAction,
} from "../_lib/actions";

interface EditPagePageProps {
  params: Promise<{
    page_id: string;
    tenant_id: string;
  }>;
}

export const metadata: Metadata = {
  title: "ページ編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "page_id");

const PageWorkspaceSkeleton = () => (
  <div className="grid gap-6">
    <div className="h-44 animate-pulse rounded-2xl bg-muted/70" />
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="h-[420px] animate-pulse rounded-2xl bg-muted/70" />
      <div className="h-[420px] animate-pulse rounded-2xl bg-muted/70" />
    </div>
    <div className="h-72 animate-pulse rounded-2xl bg-muted/70" />
  </div>
);

const PageLoadError = ({ message }: { message: string }) => (
  <SectionError
    actions={
      <LinkButton render={<Link href="/pages" />} variant="outline">
        一覧へ戻る
      </LinkButton>
    }
    description={message}
    title="ページを表示できませんでした"
  />
);

const PageWorkspaceData = async ({
  params,
}: Pick<EditPagePageProps, "params">) => {
  const { page_id: pageId } = await params;
  guardPlaceholder(pageId);

  const tenantId = await getTenantId();
  const [pageResult, versionsResult, timeZone] = await Promise.all([
    getPage({ pageId, tenantId }),
    listPageVersions({ pageId, tenantId }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!pageResult.ok) {
    if (pageResult.notFound) {
      // Missing, another tenant's page, or an id the URL could never address —
      // never told apart. Renders `(protected)/not-found.tsx` inside the
      // console chrome.
      notFound();
    }

    return <PageLoadError message={pageResult.message} />;
  }

  if (!versionsResult.ok && versionsResult.versions.length === 0) {
    return <PageLoadError message={versionsResult.message} />;
  }

  return (
    <PageWorkspace
      createDraftAction={createDraftVersionAction}
      initialPage={pageResult.page}
      initialVersions={versionsResult.versions}
      publishAction={publishVersionAction}
      rollbackAction={rollbackVersionAction}
      timeZone={timeZone}
      updatePageAction={updatePageAction}
    />
  );
};

const EditPagePage = ({ params }: EditPagePageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>ページ編集</AdminPageTitle>
        <AdminPageDescription>
          Markdown
          の編集、プレビュー確認、バージョン比較、公開/ロールバックを行います。管理者のみ実行できます。
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/pages" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast title="ページを作成しました。" />
      <FlashToast keyName="updated" title="ページ基本情報を更新しました。" />
      <FlashToast
        keyName="draft_saved"
        title="下書きバージョンを保存しました。"
      />
      <FlashToast keyName="published" title="ページを公開しました。" />
      <FlashToast
        keyName="rolled_back"
        title="指定バージョンからロールバックしました。"
      />

      <SectionErrorBoundary title="ページを表示できませんでした">
        <Suspense fallback={<PageWorkspaceSkeleton />}>
          <PageWorkspaceData params={params} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default EditPagePage;
