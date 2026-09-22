import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { TenantAdminInvitationItem } from "#lib/tenant-members";

import { resendTenantAdminInvitationAction } from "../_lib/actions";
import { InvitationCancelButton } from "./invitation-cancel-button";

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
      <ActionForm
        action={resendTenantAdminInvitationAction}
        className="grid gap-1"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="invitation_id" type="hidden" value={invitation.id} />
        <ActionFormSubmit variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.resend_action" />
          </Suspense>
        </ActionFormSubmit>
      </ActionForm>
      <InvitationCancelButton
        email={invitation.email}
        invitationId={invitation.id}
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
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.email" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.status" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.invited" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.members.columns.expires" />
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
      {invitations.map((invitation) => (
        <TableRow key={invitation.id}>
          <TableCell className="font-medium">{invitation.email}</TableCell>
          <TableCell>
            <InvitationStatusBadge status={invitation.status} />
          </TableCell>
          <TableCell>
            {formatDateTime(invitation.createdAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
          </TableCell>
          <TableCell>
            {formatDateTime(invitation.expiresAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
          </TableCell>
          <TableCell>
            <InvitationActions invitation={invitation} tenantId={tenantId} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
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
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.members.invitations_error" />
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
      {invitations.length === 0 ? (
        <CursorPageEmptyState
          description={t("admin.members.invitations_empty_description")}
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.members.invitations_title")}
          title={t("admin.members.invitations_empty_title")}
        />
      ) : (
        <InvitationTable
          invitations={invitations}
          locale={locale}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      )}
      {invitations.length > 0 || hasPageLinks ? (
        <PaginationFooter
          ariaLabel={t("admin.members.invitations_pagination_aria")}
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
