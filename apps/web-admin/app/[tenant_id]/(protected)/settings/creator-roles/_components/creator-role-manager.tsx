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

import { ActionForm, ActionFormSubmit } from "#components/action-form";
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
  creatorRoles: CreatorRoleListItem[];
  listErrorMessage?: string;
  tenantId: string;
}

const CreatorRoleListBody = ({
  creatorRoles,
  listErrorMessage,
}: {
  creatorRoles: CreatorRoleListItem[];
  listErrorMessage?: string;
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

  return <CreatorRoleList creatorRoles={creatorRoles} />;
};

export const CreatorRoleManager = ({
  creatorRoles,
  listErrorMessage,
  tenantId,
}: CreatorRoleManagerProps) => (
  <AdminSections>
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
        <div className="flex justify-end">
          <ActionFormSubmit>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.creator_roles.create_action" />
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>

    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle id={CREATOR_ROLE_LIST_TITLE_ID}>
            <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
              <Message message="admin.creator_roles.list_title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.creator_roles.list_description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <CreatorRoleListBody
        creatorRoles={creatorRoles}
        listErrorMessage={listErrorMessage}
      />
    </AdminSection>
  </AdminSections>
);
