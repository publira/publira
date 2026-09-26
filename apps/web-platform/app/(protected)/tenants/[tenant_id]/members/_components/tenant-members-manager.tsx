import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
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
import { formatDate, formatDateTime } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSections,
  PlatformSectionTitle,
} from "#components/platform-page";
import { getMessagesFor } from "#lib/messages";
import type {
  PlatformTenantAdminInvitation,
  PlatformTenantMemberSummary,
} from "#lib/tenants";
import { getEndUserStatusTone } from "#lib/user-labels";

import {
  addTenantMemberAction,
  cancelTenantAdminInvitationAction,
  createTenantAdminInvitationAction,
  removeTenantMemberAction,
  resendTenantAdminInvitationAction,
  updateTenantMemberRoleAction,
} from "../../_lib/actions";
import {
  ReportTenantMemberRemoval,
  TenantMemberRemovals,
} from "./tenant-member-removals";
import {
  CloseTenantMemberRoleDialogOnSuccess,
  TenantMemberRoleDialog,
} from "./tenant-member-role-dialog";

interface TenantMembersManagerProps {
  invitationErrorMessage?: string;
  invitations: PlatformTenantAdminInvitation[];
  invitationsNextHref?: string;
  invitationsPreviousHref?: string;
  locale: Locale;
  members: PlatformTenantMemberSummary[];
  membersErrorMessage?: string;
  membersNextHref?: string;
  membersPreviousHref?: string;
  tenantId: string;
  timeZone: string;
}

const invitationStatusTone = (status: string) => {
  if (status === "pending") {
    return "warning" as const;
  }
  if (status === "accepted") {
    return "success" as const;
  }
  if (status === "expired") {
    return "muted" as const;
  }
  return "destructive" as const;
};

/** A member's role, worded for the operator; an unknown role shows as stored. */
const TenantRoleLabel = ({ role }: { role: string }) => {
  switch (role) {
    case "tenant_admin": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.roles.tenant_admin" />
        </Suspense>
      );
    }
    case "tenant_auditor": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.roles.tenant_auditor" />
        </Suspense>
      );
    }
    case "tenant_editor": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.roles.tenant_editor" />
        </Suspense>
      );
    }
    case "tenant_member": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.roles.tenant_member" />
        </Suspense>
      );
    }
    case "tenant_owner": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.roles.tenant_owner" />
        </Suspense>
      );
    }
    default: {
      return role;
    }
  }
};

/** A member's account status; an unknown status shows as stored. */
const AccountStatusLabel = ({ status }: { status: string }) => {
  switch (status) {
    case "active": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.account_status.active" />
        </Suspense>
      );
    }
    case "inactive": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.account_status.inactive" />
        </Suspense>
      );
    }
    case "suspended": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.account_status.suspended" />
        </Suspense>
      );
    }
    default: {
      return status;
    }
  }
};

/** An invitation's status; an unknown status shows as stored. */
const InvitationStatusLabel = ({ status }: { status: string }) => {
  switch (status) {
    case "accepted": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.invitation_status.accepted" />
        </Suspense>
      );
    }
    case "canceled": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.invitation_status.canceled" />
        </Suspense>
      );
    }
    case "expired": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.invitation_status.expired" />
        </Suspense>
      );
    }
    case "pending": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.invitation_status.pending" />
        </Suspense>
      );
    }
    default: {
      return status;
    }
  }
};

/** One role the member can be given, as a choice in the role dialog. */
const TenantRoleRadio = ({
  children,
  defaultChecked,
  value,
}: {
  children: ReactNode;
  defaultChecked: boolean;
  value: string;
}) => (
  <label className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-input bg-background px-3 py-2 text-sm text-foreground">
    <input
      defaultChecked={defaultChecked}
      name="member_role"
      required
      type="radio"
      value={value}
    />
    <span>{children}</span>
  </label>
);

const TenantMemberRoleForm = ({
  member,
  tenantId,
}: {
  member: PlatformTenantMemberSummary;
  tenantId: string;
}) => (
  <TenantMemberRoleDialog>
    <DialogTrigger
      render={<Button size="sm" type="button" variant="outline" />}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
        <Message message="platform.tenants.change_role" />
      </Suspense>
    </DialogTrigger>
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport>
        <DialogPopup>
          <ActionForm
            action={updateTenantMemberRoleAction}
            className="grid gap-4"
          >
            <CloseTenantMemberRoleDialogOnSuccess />
            <input name="tenant_id" type="hidden" value={tenantId} />
            <input
              name="member_user_public_id"
              type="hidden"
              value={member.userPublicId}
            />

            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                  <Message message="platform.tenants.change_role_submit" />
                </Suspense>
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message
                    message="platform.tenants.role_update_description"
                    values={{ email: member.email, name: member.name }}
                  />
                </Suspense>
              </DialogDescription>
            </DialogHeader>

            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.tenants.new_role" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <div className="flex flex-wrap gap-2">
                  <TenantRoleRadio
                    defaultChecked={member.role === "tenant_admin"}
                    value="tenant_admin"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="platform.common.roles.tenant_admin" />
                    </Suspense>
                  </TenantRoleRadio>
                  <TenantRoleRadio
                    defaultChecked={member.role === "tenant_editor"}
                    value="tenant_editor"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="platform.common.roles.tenant_editor" />
                    </Suspense>
                  </TenantRoleRadio>
                  <TenantRoleRadio
                    defaultChecked={member.role === "tenant_auditor"}
                    value="tenant_auditor"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="platform.common.roles.tenant_auditor" />
                    </Suspense>
                  </TenantRoleRadio>
                </div>
              </FieldContent>
            </Field>

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.cancel" />
                </Suspense>
              </DialogClose>
              <ActionFormSubmit variant="outline">
                <ActionFormIdle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.tenants.change_role_submit" />
                  </Suspense>
                </ActionFormIdle>
                <ActionFormPending>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.tenants.change_role_updating" />
                  </Suspense>
                </ActionFormPending>
              </ActionFormSubmit>
            </DialogFooter>
          </ActionForm>
        </DialogPopup>
      </DialogViewport>
    </DialogPortal>
  </TenantMemberRoleDialog>
);

/**
 * Removes the member once the operator confirms it. A removal that goes
 * through is reported above the list, since this row leaves it.
 */
const TenantMemberDeleteButton = ({
  tenantId,
  userPublicId,
}: {
  tenantId: string;
  userPublicId: string;
}) => {
  const formId = `tenant-member-remove-${userPublicId}`;

  return (
    <ActionForm
      action={removeTenantMemberAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <ReportTenantMemberRemoval />
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="member_user_public_id" type="hidden" value={userPublicId} />
      <ActionFormFieldset>
        <ConfirmDialog>
          <ConfirmDialogTrigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.tenants.delete_member" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.tenants.delete_member_pending" />
              </Suspense>
            </ActionFormPending>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="platform.tenants.delete_member_title" />
                </Suspense>
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="platform.tenants.delete_member_description" />
                </Suspense>
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.cancel" />
                </Suspense>
              </ConfirmDialogCancel>
              <ConfirmDialogAction form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.tenants.delete_member_action" />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};

/**
 * Resending and canceling are separate forms, each answering on this row: the
 * invitation stays listed either way, with the status the change left it in.
 */
const TenantInvitationActions = ({
  invitation,
  tenantId,
}: {
  invitation: PlatformTenantAdminInvitation;
  tenantId: string;
}) => {
  const canOperate = invitation.status === "pending";
  const cancelFormId = `tenant-invitation-cancel-${invitation.id}`;

  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm
        action={resendTenantAdminInvitationAction}
        className="grid gap-1"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="invitation_id" type="hidden" value={invitation.id} />
        <ActionFormSubmit disabled={!canOperate} size="sm" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.tenants.resend_invite" />
          </Suspense>
        </ActionFormSubmit>
      </ActionForm>
      <ActionForm
        action={cancelTenantAdminInvitationAction}
        className="grid gap-1"
        id={cancelFormId}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="invitation_id" type="hidden" value={invitation.id} />
        <ActionFormFieldset disabled={!canOperate}>
          <ConfirmDialog>
            <ConfirmDialogTrigger
              render={<Button size="sm" type="button" variant="destructive" />}
            >
              <ActionFormIdle>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.tenants.cancel_invite" />
                </Suspense>
              </ActionFormIdle>
              <ActionFormPending>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.tenants.cancel_invite_pending" />
                </Suspense>
              </ActionFormPending>
            </ConfirmDialogTrigger>
            <ConfirmDialogContent>
              <ConfirmDialogHeader>
                <ConfirmDialogTitle>
                  <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                    <Message message="platform.tenants.cancel_invite_title" />
                  </Suspense>
                </ConfirmDialogTitle>
                <ConfirmDialogDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                    <Message message="platform.tenants.cancel_invite_description" />
                  </Suspense>
                </ConfirmDialogDescription>
              </ConfirmDialogHeader>
              <ConfirmDialogFooter>
                <ConfirmDialogCancel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="platform.common.cancel" />
                  </Suspense>
                </ConfirmDialogCancel>
                <ConfirmDialogAction form={cancelFormId}>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="platform.tenants.cancel_invite_action" />
                  </Suspense>
                </ConfirmDialogAction>
              </ConfirmDialogFooter>
            </ConfirmDialogContent>
          </ConfirmDialog>
        </ActionFormFieldset>
      </ActionForm>
    </div>
  );
};

const TenantInvitationsTable = ({
  invitations,
  locale,
  tenantId,
  timeZone,
}: {
  invitations: PlatformTenantAdminInvitation[];
  locale: Locale;
  tenantId: string;
  timeZone: string;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.tenants.members_columns_email" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.tenants.members_columns_status" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.tenants.members_columns_invited_at" />
          </Suspense>
        </TableHead>
        <TableHead>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.tenants.members_columns_expires" />
          </Suspense>
        </TableHead>
        <TableHead className="w-56">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.tenants.members_columns_actions" />
          </Suspense>
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {invitations.length === 0 ? (
        <TableRow>
          <TableCell className="text-muted-foreground" colSpan={5}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message message="platform.tenants.invitations_empty" />
            </Suspense>
          </TableCell>
        </TableRow>
      ) : null}

      {invitations.map((invitation) => (
        <TableRow key={invitation.id}>
          <TableCell>{invitation.email}</TableCell>
          <TableCell>
            <Badge tone={invitationStatusTone(invitation.status)}>
              <InvitationStatusLabel status={invitation.status} />
            </Badge>
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
            <TenantInvitationActions
              invitation={invitation}
              tenantId={tenantId}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const TenantMembersManager = async ({
  invitationErrorMessage,
  invitations,
  invitationsNextHref,
  invitationsPreviousHref,
  locale,
  members,
  membersErrorMessage,
  membersNextHref,
  membersPreviousHref,
  tenantId,
  timeZone,
}: TenantMembersManagerProps) => {
  const t = await getMessagesFor(locale);

  return (
    <PlatformSections>
      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
                <Message message="platform.tenants.invite_admin_title" />
              </Suspense>
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.invite_admin_description" />
              </Suspense>
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        <ActionForm
          action={createTenantAdminInvitationAction}
          className="grid gap-4"
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="platform.tenants.invite_admin_email" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                name="invite_email"
                placeholder="admin@example.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>

          <div className="flex justify-end">
            <ActionFormSubmit variant="outline">
              <ActionFormIdle>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.tenants.invite_admin" />
                </Suspense>
              </ActionFormIdle>
              <ActionFormPending>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.tenants.invite_admin_pending" />
                </Suspense>
              </ActionFormPending>
            </ActionFormSubmit>
          </div>
        </ActionForm>
      </PlatformSection>

      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                <Message message="platform.tenants.members_list_title" />
              </Suspense>
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.members_list_description" />
              </Suspense>
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        <TenantMemberRemovals>
          {membersErrorMessage ? (
            <SectionError>
              <SectionErrorHeading>
                <SectionErrorTitle>
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="platform.tenants.members_load_failed" />
                  </Suspense>
                </SectionErrorTitle>
                <SectionErrorDescription>
                  {membersErrorMessage}
                </SectionErrorDescription>
              </SectionErrorHeading>
            </SectionError>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="platform.tenants.members_columns_name" />
                      </Suspense>
                    </TableHead>
                    <TableHead>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="platform.tenants.members_columns_email" />
                      </Suspense>
                    </TableHead>
                    <TableHead>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="platform.tenants.members_columns_role" />
                      </Suspense>
                    </TableHead>
                    <TableHead>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="platform.tenants.members_columns_status" />
                      </Suspense>
                    </TableHead>
                    <TableHead>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-20" />}
                      >
                        <Message message="platform.tenants.members_columns_created" />
                      </Suspense>
                    </TableHead>
                    <TableHead className="w-56">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="platform.tenants.members_columns_actions" />
                      </Suspense>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground" colSpan={6}>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-48" />}
                        >
                          <Message message="platform.tenants.members_empty" />
                        </Suspense>
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {members.map((member) => (
                    <TableRow key={member.userPublicId || member.email}>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {member.name}
                        </p>
                      </TableCell>
                      <TableCell>{member.email}</TableCell>
                      <TableCell>
                        <TenantRoleLabel role={member.role} />
                      </TableCell>
                      <TableCell>
                        <Badge tone={getEndUserStatusTone(member.status)}>
                          <AccountStatusLabel status={member.status} />
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDate(member.createdAt, {
                          fallback: t("platform.common.unset"),
                          locale,
                          timeZone,
                        })}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-start gap-2">
                          <TenantMemberRoleForm
                            member={member}
                            tenantId={tenantId}
                          />
                          <TenantMemberDeleteButton
                            tenantId={tenantId}
                            userPublicId={member.userPublicId}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationControls
                aria-label={t("platform.tenants.members_pagination_aria")}
                nextHref={membersNextHref}
                previousHref={membersPreviousHref}
              />
            </>
          )}
        </TenantMemberRemovals>
      </PlatformSection>

      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                <Message message="platform.tenants.add_member" />
              </Suspense>
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.add_member_description" />
              </Suspense>
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        <ActionForm action={addTenantMemberAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="platform.tenants.add_member_email" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                name="member_email"
                placeholder="member@example.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.common.role" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Select
                defaultValue="tenant_admin"
                items={[
                  {
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="platform.common.roles.tenant_admin" />
                      </Suspense>
                    ),
                    value: "tenant_admin",
                  },
                  {
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="platform.common.roles.tenant_editor" />
                      </Suspense>
                    ),
                    value: "tenant_editor",
                  },
                  {
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="platform.common.roles.tenant_auditor" />
                      </Suspense>
                    ),
                    value: "tenant_auditor",
                  },
                ]}
                name="member_role"
                required
              />
            </FieldContent>
          </Field>
          <div className="flex justify-end">
            <ActionFormSubmit variant="outline">
              <ActionFormIdle>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.tenants.add_member_submit" />
                </Suspense>
              </ActionFormIdle>
              <ActionFormPending>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.tenants.add_member_pending" />
                </Suspense>
              </ActionFormPending>
            </ActionFormSubmit>
          </div>
        </ActionForm>
      </PlatformSection>

      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                <Message message="platform.tenants.invitations_title" />
              </Suspense>
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.invitations_description" />
              </Suspense>
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        {/* A failed fetch still hands an empty `invitations` array. Keeping the
            table header and the pager next to the error reads as "there are no
            invitations", so the error replaces the whole list. */}
        {invitationErrorMessage ? (
          <SectionError>
            <SectionErrorHeading>
              <SectionErrorTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="platform.tenants.invitations_load_failed" />
                </Suspense>
              </SectionErrorTitle>
              <SectionErrorDescription>
                {invitationErrorMessage}
              </SectionErrorDescription>
            </SectionErrorHeading>
          </SectionError>
        ) : (
          <>
            <TenantInvitationsTable
              invitations={invitations}
              locale={locale}
              tenantId={tenantId}
              timeZone={timeZone}
            />
            <PaginationControls
              aria-label={t("platform.tenants.invitations_pagination_aria")}
              nextHref={invitationsNextHref}
              previousHref={invitationsPreviousHref}
            />
          </>
        )}
      </PlatformSection>
    </PlatformSections>
  );
};
