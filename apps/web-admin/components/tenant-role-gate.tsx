import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  isSignedInTenantAdmin,
  isSignedInTenantEditor,
} from "#lib/auth-session";
import { getTenantId } from "#lib/tenant-id";

import { Message } from "./message";

/*
 * What the console shows each tenant role, by the levels the API places its
 * RPCs at: a tenant_admin is shown everything, a tenant_editor everything but
 * what administers the tenant, and a tenant_auditor what an editor reads and
 * none of what an editor writes. The API refuses whatever these hide; they
 * exist so an operator never meets a control that can only fail.
 */

/**
 * What a route behind {@link TenantAdminRoute} or {@link TenantEditorRoute}
 * shows while the role is read: a heading over a table.
 */
export const TenantRoleRouteSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-2">
      <SkeletonLine className="h-7 w-32" />
      <SkeletonLine className="h-4 w-80" />
    </div>
    <TableSkeleton />
  </div>
);

/**
 * A route only a tenant admin may use. Every other role is answered not found,
 * so an editor or an auditor cannot tell it from a route that does not exist,
 * and nothing of the screen is painted before the role is known.
 */
export const TenantAdminRoute = async ({
  children,
}: {
  children: ReactNode;
}) => {
  if (!(await isSignedInTenantAdmin(await getTenantId()))) {
    notFound();
  }

  return children;
};

/**
 * A route that exists only to write, such as a creation form, which a tenant
 * auditor is answered not found on.
 */
export const TenantEditorRoute = async ({
  children,
}: {
  children: ReactNode;
}) => {
  if (!(await isSignedInTenantEditor(await getTenantId()))) {
    notFound();
  }

  return children;
};

/** What only a tenant admin is shown, such as a navigation entry or a link. */
export const TenantAdminOnly = async ({ children }: { children: ReactNode }) =>
  (await isSignedInTenantAdmin(await getTenantId())) ? children : null;

/** A write control, such as a create button, a tenant auditor is not shown. */
export const TenantEditorOnly = async ({
  children,
}: {
  children: ReactNode;
}) => ((await isSignedInTenantEditor(await getTenantId())) ? children : null);

/**
 * Forms a tenant auditor may read but not submit. For an editor they are left
 * as they are; for an auditor every control inside is disabled by a disabled
 * {@link Fieldset}, links excepted, under a notice saying why: a bare
 * `<fieldset>` would leave a checkbox, which Base UI renders as a `<span>`,
 * still clickable. The fieldset lays out as its children would, so the screen
 * keeps its shape either way.
 */
export const TenantEditorFieldset = async ({
  children,
}: {
  children: ReactNode;
}) => {
  if (await isSignedInTenantEditor(await getTenantId())) {
    return children;
  }

  return (
    <>
      <FormMessage variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="admin.common.editor_only" />
        </Suspense>
      </FormMessage>
      <Fieldset className="contents" disabled>
        {children}
      </Fieldset>
    </>
  );
};

/**
 * Settings every member of staff may read and only a tenant admin change,
 * disabled for every other role under the notice the settings forms give.
 */
export const TenantAdminFieldset = async ({
  children,
}: {
  children: ReactNode;
}) => {
  if (await isSignedInTenantAdmin(await getTenantId())) {
    return children;
  }

  return (
    <>
      <FormMessage variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="admin.settings.admin_only" />
        </Suspense>
      </FormMessage>
      <Fieldset className="contents" disabled>
        {children}
      </Fieldset>
    </>
  );
};
