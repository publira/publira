import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { Field, FieldLabel } from "@publira/ui-components/field";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDate } from "@publira/utils";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormSubmit,
} from "#components/action-form";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { TenantMemberItem } from "#lib/tenant-members";

import { updateTenantMemberRoleAction } from "../_lib/actions";
import { MemberRemoveButton } from "./member-remove-button";

type MemberListProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  members: TenantMemberItem[];
  pageSize: number;
  tenantId: string;
  timeZone: string;
};

const roleItems = [
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
        <Message message="admin.common.roles.tenant_admin" />
      </Suspense>
    ),
    value: "tenant_admin",
  },
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.common.roles.tenant_editor" />
      </Suspense>
    ),
    value: "tenant_editor",
  },
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.common.roles.tenant_auditor" />
      </Suspense>
    ),
    value: "tenant_auditor",
  },
];

const MemberStatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case "active": {
      return (
        <Badge tone="success">
          <Suspense fallback={<SkeletonLine className="h-3 w-10" />}>
            <Message message="admin.members.status.active" />
          </Suspense>
        </Badge>
      );
    }
    case "suspended": {
      return (
        <Badge tone="destructive">
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            <Message message="admin.members.status.suspended" />
          </Suspense>
        </Badge>
      );
    }
    case "inactive": {
      return (
        <Badge tone="muted">
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            <Message message="admin.members.status.inactive" />
          </Suspense>
        </Badge>
      );
    }
    default: {
      return <Badge tone="muted">{status}</Badge>;
    }
  }
};

const MemberRoleForm = ({
  member,
  tenantId,
}: {
  member: TenantMemberItem;
  tenantId: string;
}) => (
  <ActionForm action={updateTenantMemberRoleAction} className="grid gap-2">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="user_public_id" type="hidden" value={member.userPublicId} />
    <div className="flex flex-wrap items-center gap-2">
      <ActionFormFieldset>
        <Field className="min-w-36">
          <FieldLabel className="sr-only">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message
                message="admin.members.role_label"
                values={{ name: member.name || member.email }}
              />
            </Suspense>
          </FieldLabel>
          {/* Keyed by the role so a change made elsewhere, such as an
            invitation granting it on the spot, replaces the selection. */}
          <Select
            defaultValue={member.role}
            items={roleItems}
            key={member.role}
            name="role"
          />
        </Field>
      </ActionFormFieldset>
      <ActionFormSubmit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.members.role_submit" />
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);

const MemberTable = ({
  locale,
  members,
  tenantId,
  timeZone,
}: Pick<MemberListProps, "locale" | "members" | "tenantId" | "timeZone">) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.name" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.email" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.role" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.status" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.joined" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.actions" />
          </Suspense>
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {members.map((member) => (
        <TableRow key={member.userPublicId}>
          <TableCell className="font-medium">{member.name}</TableCell>
          <TableCell>{member.email}</TableCell>
          <TableCell>
            <MemberRoleForm member={member} tenantId={tenantId} />
          </TableCell>
          <TableCell>
            <MemberStatusBadge status={member.status} />
          </TableCell>
          <TableCell>
            {formatDate(member.createdAt, { fallback: "-", locale, timeZone })}
          </TableCell>
          <TableCell>
            <MemberRemoveButton
              name={member.name || member.email}
              userPublicId={member.userPublicId}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const MemberList = async ({
  listErrorMessage,
  locale,
  members,
  nextHref,
  pageSize,
  previousHref,
  tenantId,
  timeZone,
}: MemberListProps) => {
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no members".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.members.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  return (
    <div className="grid gap-4">
      {members.length === 0 ? (
        <CursorPageEmptyState
          description={t("admin.members.empty_description")}
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.members.list_title")}
          title={t("admin.members.empty_title")}
        />
      ) : (
        <MemberTable
          locale={locale}
          members={members}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      )}
      {members.length > 0 || hasPageLinks ? (
        <PaginationFooter
          ariaLabel={t("admin.members.pagination_aria")}
          description={t("admin.members.pagination_description", {
            count: String(pageSize),
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
