import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { TenantAdminInvitationItem } from "#lib/tenant-members";

import { resendTenantAdminInvitationAction } from "../_lib/actions";
import { InvitationCancelButton } from "./invitation-cancel-button";
import { MemberRoleLabel } from "./member-role-items";

type InvitationListProps = CursorPageHrefs & {
  invitations: TenantAdminInvitationItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  tenantId: string;
  timeZone: string;
};

const InvitationStatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case "pending": {
      return (
        <Badge tone="warning">
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            <Message message="admin.members.invitation_status.pending" />
          </Suspense>
        </Badge>
      );
    }

    case "accepted": {
      return (
        <Badge tone="success">
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            <Message message="admin.members.invitation_status.accepted" />
          </Suspense>
        </Badge>
      );
    }

    case "canceled": {
      return (
        <Badge tone="destructive">
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            <Message message="admin.members.invitation_status.canceled" />
          </Suspense>
        </Badge>
      );
    }

    case "expired": {
      return (
        <Badge tone="muted">
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            <Message message="admin.members.invitation_status.expired" />
          </Suspense>
        </Badge>
      );
    }

    default: {
      return <Badge tone="muted">{status}</Badge>;
    }
  }
};

/** Only a pending link can still be mailed again or stopped. */
const InvitationActions = ({
  invitation,
  tenantId,
}: {
  invitation: TenantAdminInvitationItem;
  tenantId: string;
}) =>
  invitation.status === "pending" ? (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm.Root
        action={resendTenantAdminInvitationAction}
        className="grid gap-1"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="invitation_id" type="hidden" value={invitation.id} />
        <ActionForm.Submit variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.resend_action" />
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Root>
      <InvitationCancelButton
        email={invitation.email}
        invitationId={invitation.id}
        tenantId={tenantId}
      />
    </div>
  ) : null;

const InvitationTable = ({
  invitations,
  locale,
  tenantId,
  timeZone,
}: Pick<
  InvitationListProps,
  "invitations" | "locale" | "tenantId" | "timeZone"
>) => (
  <Table.Root>
    <Table.Header>
      <Table.Row>
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
            <Message message="admin.members.columns.invited" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.expires" />
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
      {invitations.map((invitation) => (
        <Table.Row key={invitation.id}>
          <Table.Cell className="font-medium">{invitation.email}</Table.Cell>
          <Table.Cell>
            <MemberRoleLabel role={invitation.role} />
          </Table.Cell>
          <Table.Cell>
            <InvitationStatusBadge status={invitation.status} />
          </Table.Cell>
          <Table.Cell>
            {formatDateTime(invitation.createdAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
          </Table.Cell>
          <Table.Cell>
            {formatDateTime(invitation.expiresAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
          </Table.Cell>
          <Table.Cell>
            <InvitationActions invitation={invitation} tenantId={tenantId} />
          </Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
);

export const InvitationList = async ({
  invitations,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  tenantId,
  timeZone,
}: InvitationListProps) => {
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "nobody has been invited".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.members.invitations_error" />
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
      {invitations.length === 0 ? (
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.members.invitations_title")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              {t("admin.members.invitations_empty_title")}
            </EmptyState.Title>
            <EmptyState.Description>
              {t("admin.members.invitations_empty_description")}
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
      ) : (
        <InvitationTable
          invitations={invitations}
          locale={locale}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      )}
      {invitations.length > 0 || hasPageLinks ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.members.pagination_description", {
              count: String(pageSize),
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.members.invitations_pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
