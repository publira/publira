import {
  ActionForm,
  ActionFormFieldset,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

import { createCreatorRoleAction } from "../_lib/actions";
import type { CreatorRoleListItem } from "../creator-role-types";
import { CREATOR_ROLE_LIST_TITLE_ID } from "../creator-role-types";
import { CreatorRoleList } from "./creator-role-list";
import { CreatorRoleNameInput } from "./creator-role-name-input";

interface CreatorRoleManagerProps {
  /** Whether the operator may write the roles, which a tenant auditor may not. */
  canEdit: boolean;
  creatorRoles: CreatorRoleListItem[];
  listErrorMessage?: string;
  tenantId: string;
}

const CreatorRoleListBody = ({
  canEdit,
  creatorRoles,
  listErrorMessage,
  tenantId,
}: {
  canEdit: boolean;
  creatorRoles: CreatorRoleListItem[];
  listErrorMessage?: string;
  tenantId: string;
}) => {
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no roles".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.creator_roles.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  // A tenant is created with the starting vocabulary, so an empty list means
  // every default role has since been deleted rather than that the screen has
  // not been used yet.
  if (creatorRoles.length === 0) {
    return (
      <EmptyState>
        <EmptyStateHeading>
          <EmptyStateTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.creator_roles.empty_title" />
            </Suspense>
          </EmptyStateTitle>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.creator_roles.empty_description" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyStateHeading>
      </EmptyState>
    );
  }

  return (
    <CreatorRoleList
      canEdit={canEdit}
      creatorRoles={creatorRoles}
      tenantId={tenantId}
    />
  );
};

export const CreatorRoleManager = ({
  canEdit,
  creatorRoles,
  listErrorMessage,
  tenantId,
}: CreatorRoleManagerProps) => (
  <AdminSections>
    {canEdit ? (
      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-6 w-28" />}>
                <Message message="admin.creator_roles.create_card_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="admin.creator_roles.create_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        <ActionForm action={createCreatorRoleAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <ActionFormFieldset>
            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.creator_roles.form.name" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <Suspense
                  fallback={<Skeleton className="h-9 w-full sm:max-w-sm" />}
                >
                  <CreatorRoleNameInput />
                </Suspense>
              </FieldContent>
            </Field>
          </ActionFormFieldset>
          <div className="flex justify-end">
            <ActionFormSubmit>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.creator_roles.create_action" />
              </Suspense>
            </ActionFormSubmit>
          </div>
        </ActionForm>
      </AdminSection>
    ) : null}

    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle id={CREATOR_ROLE_LIST_TITLE_ID}>
            <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
              <Message message="admin.creator_roles.list_title" />
            </Suspense>
          </AdminSectionTitle>
          {canEdit ? (
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.creator_roles.list_description" />
              </Suspense>
            </AdminSectionDescription>
          ) : null}
        </AdminSectionHeading>
      </AdminSectionHeader>
      <CreatorRoleListBody
        canEdit={canEdit}
        creatorRoles={creatorRoles}
        listErrorMessage={listErrorMessage}
        tenantId={tenantId}
      />
    </AdminSection>
  </AdminSections>
);
