import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as Field from "@publira/ui-components/field";
import * as SectionError from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDate } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { TenantMemberItem } from "#lib/tenant-members";

import { updateTenantMemberRoleAction } from "../_lib/actions";
import { MemberRemoveButton } from "./member-remove-button";
import { memberRoleItems } from "./member-role-items";

type MemberListProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  members: TenantMemberItem[];
  pageSize: number;
  tenantId: string;
  timeZone: string;
};

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
  <ActionForm.Root action={updateTenantMemberRoleAction} className="grid gap-2">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="user_id" type="hidden" value={member.userId} />
    <div className="flex flex-wrap items-center gap-2">
      <ActionForm.Fieldset>
        <Field.Root className="min-w-36">
          <Field.Label className="sr-only">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message
                message="admin.members.role_label"
                values={{ name: member.name || member.email }}
              />
            </Suspense>
          </Field.Label>
          {/* Keyed by the role so a change made elsewhere, such as an
            invitation granting it on the spot, replaces the selection. */}
          <Select
            defaultValue={member.role}
            items={memberRoleItems}
            key={member.role}
            name="role"
          />
        </Field.Root>
      </ActionForm.Fieldset>
      <ActionForm.Submit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.members.role_submit" />
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MemberTable = ({
  locale,
  members,
  tenantId,
  timeZone,
}: Pick<MemberListProps, "locale" | "members" | "tenantId" | "timeZone">) => (
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.name" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.email" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.role" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.status" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.joined" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.actions" />
          </Suspense>
        </Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {members.map((member) => (
        <Table.Row key={member.userId}>
          <Table.Cell>
            {/* A member is an account of the tenant like any reader, and
              their reader page is where the account is suspended or deleted. */}
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/readers/${member.publicId}`}
            >
              {member.name || member.publicId}
            </Link>
          </Table.Cell>
          <Table.Cell>{member.email}</Table.Cell>
          <Table.Cell>
            <MemberRoleForm member={member} tenantId={tenantId} />
          </Table.Cell>
          <Table.Cell>
            <MemberStatusBadge status={member.status} />
          </Table.Cell>
          <Table.Cell>
            {formatDate(member.createdAt, { fallback: "-", locale, timeZone })}
          </Table.Cell>
          <Table.Cell>
            <MemberRemoveButton
              name={member.name || member.email}
              tenantId={tenantId}
              userId={member.userId}
            />
          </Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
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
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.members.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  return (
    <div className="grid gap-4">
      {members.length === 0 ? (
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.members.list_title")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              {t("admin.members.empty_title")}
            </EmptyState.Title>
            <EmptyState.Description>
              {t("admin.members.empty_description")}
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
      ) : (
        <MemberTable
          locale={locale}
          members={members}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      )}
      {members.length > 0 || hasPageLinks ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.members.pagination_description", {
              count: String(pageSize),
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.members.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
