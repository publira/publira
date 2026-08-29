import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
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
import { Message } from "#components/message";
import { getAdminMetadata } from "#lib/admin-metadata";

import { CreatorForm } from "../_components/creator-form";
import { createCreatorAction } from "../_lib/actions";

export const generateMetadata = () =>
  getAdminMetadata("admin.creators.new_title");

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
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Message message="admin.creators.new_title" />
        </AdminPageTitle>
        <AdminPageDescription>
          <Message message="admin.creators.new_description" />
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/creators" />} variant="outline">
          <Message message="admin.creators.back_to_list" />
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<NewCreatorFormSkeleton />}>
        <NewCreatorFormData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NewCreatorPage;
