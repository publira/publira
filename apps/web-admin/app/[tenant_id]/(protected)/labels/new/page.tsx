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

import { LabelForm } from "../_components/label-form";
import { createLabelAction } from "../_lib/actions";

export const generateMetadata = () =>
  getAdminMetadata("admin.labels.new_title");

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
        <AdminPageTitle>
          <Message message="admin.labels.new_title" />
        </AdminPageTitle>
        <AdminPageDescription>
          <Message message="admin.labels.new_description" />
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/labels" />} variant="outline">
          <Message message="admin.labels.back_to_list" />
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
