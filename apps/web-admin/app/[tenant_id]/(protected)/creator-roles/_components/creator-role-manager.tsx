import * as ActionForm from "@publira/ui-components/action-form";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as Field from "@publira/ui-components/field";
import * as SectionError from "@publira/ui-components/section-error";
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
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.creator_roles.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  // A tenant is created with the starting vocabulary, so an empty list means
  // every default role has since been deleted rather than that the screen has
  // not been used yet.
  if (creatorRoles.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.creator_roles.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.creator_roles.empty_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
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
        <ActionForm.Root
          action={createCreatorRoleAction}
          className="grid gap-4"
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <ActionForm.Fieldset>
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.creator_roles.form.name" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Suspense
                  fallback={<Skeleton className="h-9 w-full sm:max-w-sm" />}
                >
                  <CreatorRoleNameInput />
                </Suspense>
              </Field.Content>
            </Field.Root>
          </ActionForm.Fieldset>
          <div className="flex justify-end">
            <ActionForm.Submit>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.creator_roles.create_action" />
              </Suspense>
            </ActionForm.Submit>
          </div>
        </ActionForm.Root>
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
