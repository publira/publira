import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
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

import { LabelForm } from "../_components/label-form";
import { createLabelAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "レーベル新規作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewLabelFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NewLabelFormData = () => (
  <LabelForm action={createLabelAction} mode="create" />
);

const NewLabelPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>レーベル新規作成</AdminPageTitle>
        <AdminPageDescription>
          新しいレーベルを登録します。
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/labels" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<NewLabelFormSkeleton />}>
        <NewLabelFormData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NewLabelPage;
