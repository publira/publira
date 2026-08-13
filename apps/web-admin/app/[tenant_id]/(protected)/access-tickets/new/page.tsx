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
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { TicketForm } from "../_components/ticket-form";
import { issueAccessTicketAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "アクセスチケット発行",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewAccessTicketFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NewAccessTicketFormData = async () => {
  const tenantId = await getTenantId();
  const timeZone = await getTenantDisplayTimeZone(tenantId);
  return <TicketForm action={issueAccessTicketAction} timeZone={timeZone} />;
};

const NewAccessTicketPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>チケットを発行</AdminPageTitle>
        <AdminPageDescription>
          ユーザーとエピソードを指定して限定閲覧チケットを発行します。
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/access-tickets" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<NewAccessTicketFormSkeleton />}>
        <NewAccessTicketFormData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NewAccessTicketPage;
