import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as SectionError from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDate, formatDateTime } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
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
import * as TenantMemberRemovals from "./tenant-member-removals";
import * as TenantMemberRoleDialog from "./tenant-member-role-dialog";

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

/**
 * A member's role, or the one an invitation grants, worded for the operator; an
 * unknown role shows as stored.
 */
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
  <TenantMemberRoleDialog.Root>
    <Dialog.Trigger
      render={<Button size="sm" type="button" variant="outline" />}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
        <Message message="platform.tenants.change_role" />
      </Suspense>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Viewport>
        <Dialog.Popup>
          <ActionForm.Root
            action={updateTenantMemberRoleAction}
            className="grid gap-4"
          >
            <TenantMemberRoleDialog.CloseOnSuccess />
            <input name="tenant_id" type="hidden" value={tenantId} />
            <input name="member_user_id" type="hidden" value={member.userId} />

            <Dialog.Header>
              <Dialog.Title className="text-lg font-semibold">
                <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                  <Message message="platform.tenants.change_role_submit" />
                </Suspense>
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message
                    message="platform.tenants.role_update_description"
                    values={{ email: member.email, name: member.name }}
                  />
                </Suspense>
              </Dialog.Description>
            </Dialog.Header>

            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.tenants.new_role" />
                </Suspense>
              </Field.Label>
              <Field.Content>
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
              </Field.Content>
            </Field.Root>

            <Dialog.Footer>
              <Dialog.Close render={<Button type="button" variant="outline" />}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.cancel" />
                </Suspense>
              </Dialog.Close>
              <ActionForm.Submit variant="outline">
                <ActionForm.Idle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.tenants.change_role_submit" />
                  </Suspense>
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.tenants.change_role_updating" />
                  </Suspense>
                </ActionForm.Pending>
              </ActionForm.Submit>
            </Dialog.Footer>
          </ActionForm.Root>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </TenantMemberRoleDialog.Root>
);

/**
 * Removes the member once the operator confirms it. A removal that goes
 * through is reported above the list, since this row leaves it.
 */
const TenantMemberDeleteButton = ({
  tenantId,
  userId,
}: {
  tenantId: string;
  userId: string;
}) => {
  const formId = `tenant-member-remove-${userId}`;

  return (
    <ActionForm.Root
      action={removeTenantMemberAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <TenantMemberRemovals.Report />
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="member_user_id" type="hidden" value={userId} />
      <ActionForm.Fieldset>
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.tenants.delete_member" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.tenants.delete_member_pending" />
              </Suspense>
            </ActionForm.Pending>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="platform.tenants.delete_member_title" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="platform.tenants.delete_member_description" />
                </Suspense>
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.tenants.delete_member_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};

/**
 * Resending and canceling are separate forms, each answering on this row: the
 * invitation stays listed either way, with the status the change left it in.
 * An expired invitation can still be resent — `ResendTenantAdminInvitation`
 * gives it a new link and a new expiry — while only a pending one has a link
 * left to cancel.
 */
const TenantInvitationActions = ({
  invitation,
  tenantId,
}: {
  invitation: PlatformTenantAdminInvitation;
  tenantId: string;
}) => {
  const canResend =
    invitation.status === "pending" || invitation.status === "expired";

  const canCancel = invitation.status === "pending";
  const cancelFormId = `tenant-invitation-cancel-${invitation.id}`;

  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm.Root
        action={resendTenantAdminInvitationAction}
        className="grid gap-1"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="invitation_id" type="hidden" value={invitation.id} />
        <ActionForm.Submit disabled={!canResend} size="sm" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.tenants.resend_invite" />
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Root>
      <ActionForm.Root
        action={cancelTenantAdminInvitationAction}
        className="grid gap-1"
        id={cancelFormId}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="invitation_id" type="hidden" value={invitation.id} />
        <ActionForm.Fieldset disabled={!canCancel}>
          <ConfirmDialog.Root>
            <ConfirmDialog.Trigger
              render={<Button size="sm" type="button" variant="destructive" />}
            >
              <ActionForm.Idle>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.tenants.cancel_invite" />
                </Suspense>
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.tenants.cancel_invite_pending" />
                </Suspense>
              </ActionForm.Pending>
            </ConfirmDialog.Trigger>
            <ConfirmDialog.Content>
              <ConfirmDialog.Header>
                <ConfirmDialog.Title>
                  <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                    <Message message="platform.tenants.cancel_invite_title" />
                  </Suspense>
                </ConfirmDialog.Title>
                <ConfirmDialog.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                    <Message message="platform.tenants.cancel_invite_description" />
                  </Suspense>
                </ConfirmDialog.Description>
              </ConfirmDialog.Header>
              <ConfirmDialog.Footer>
                <ConfirmDialog.Cancel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="platform.common.cancel" />
                  </Suspense>
                </ConfirmDialog.Cancel>
                <ConfirmDialog.Action form={cancelFormId}>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="platform.tenants.cancel_invite_action" />
                  </Suspense>
                </ConfirmDialog.Action>
              </ConfirmDialog.Footer>
            </ConfirmDialog.Content>
          </ConfirmDialog.Root>
        </ActionForm.Fieldset>
      </ActionForm.Root>
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
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.tenants.members_columns_email" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.tenants.members_columns_role" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.tenants.members_columns_status" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.tenants.members_columns_invited_at" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.tenants.members_columns_expires" />
          </Suspense>
        </Table.Head>
        <Table.Head className="w-56">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.tenants.members_columns_actions" />
          </Suspense>
        </Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {invitations.length === 0 ? (
        <Table.Row>
          <Table.Cell className="text-muted-foreground" colSpan={6}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message message="platform.tenants.invitations_empty" />
            </Suspense>
          </Table.Cell>
        </Table.Row>
      ) : null}

      {invitations.map((invitation) => (
        <Table.Row key={invitation.id}>
          <Table.Cell>{invitation.email}</Table.Cell>
          <Table.Cell>
            <TenantRoleLabel role={invitation.role} />
          </Table.Cell>
          <Table.Cell>
            <Badge tone={invitationStatusTone(invitation.status)}>
              <InvitationStatusLabel status={invitation.status} />
            </Badge>
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
            <TenantInvitationActions
              invitation={invitation}
              tenantId={tenantId}
            />
          </Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
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
    <ConsoleSection.Stack>
      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
                <Message message="platform.tenants.invite_admin_title" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.invite_admin_description" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        <ActionForm.Root
          action={createTenantAdminInvitationAction}
          className="grid gap-4"
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="platform.tenants.invite_admin_email" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                name="invite_email"
                placeholder="admin@example.com"
                required
                type="email"
              />
            </Field.Content>
          </Field.Root>

          <div className="flex justify-end">
            <ActionForm.Submit variant="outline">
              <ActionForm.Idle>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.tenants.invite_admin" />
                </Suspense>
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.tenants.invite_admin_pending" />
                </Suspense>
              </ActionForm.Pending>
            </ActionForm.Submit>
          </div>
        </ActionForm.Root>
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                <Message message="platform.tenants.members_list_title" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.members_list_description" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        <TenantMemberRemovals.Root>
          {membersErrorMessage ? (
            <SectionError.Root>
              <SectionError.Heading>
                <SectionError.Title>
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="platform.tenants.members_load_failed" />
                  </Suspense>
                </SectionError.Title>
                <SectionError.Description>
                  {membersErrorMessage}
                </SectionError.Description>
              </SectionError.Heading>
            </SectionError.Root>
          ) : (
            <>
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="platform.tenants.members_columns_name" />
                      </Suspense>
                    </Table.Head>
                    <Table.Head>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="platform.tenants.members_columns_email" />
                      </Suspense>
                    </Table.Head>
                    <Table.Head>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="platform.tenants.members_columns_role" />
                      </Suspense>
                    </Table.Head>
                    <Table.Head>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="platform.tenants.members_columns_status" />
                      </Suspense>
                    </Table.Head>
                    <Table.Head>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-20" />}
                      >
                        <Message message="platform.tenants.members_columns_created" />
                      </Suspense>
                    </Table.Head>
                    <Table.Head className="w-56">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="platform.tenants.members_columns_actions" />
                      </Suspense>
                    </Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {members.length === 0 ? (
                    <Table.Row>
                      <Table.Cell className="text-muted-foreground" colSpan={6}>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-48" />}
                        >
                          <Message message="platform.tenants.members_empty" />
                        </Suspense>
                      </Table.Cell>
                    </Table.Row>
                  ) : null}
                  {members.map((member) => (
                    <Table.Row key={member.userId || member.email}>
                      <Table.Cell>
                        <p className="font-medium text-foreground">
                          {member.name}
                        </p>
                      </Table.Cell>
                      <Table.Cell>{member.email}</Table.Cell>
                      <Table.Cell>
                        <TenantRoleLabel role={member.role} />
                      </Table.Cell>
                      <Table.Cell>
                        <Badge tone={getEndUserStatusTone(member.status)}>
                          <AccountStatusLabel status={member.status} />
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        {formatDate(member.createdAt, {
                          fallback: t("platform.common.unset"),
                          locale,
                          timeZone,
                        })}
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-wrap items-start gap-2">
                          <TenantMemberRoleForm
                            member={member}
                            tenantId={tenantId}
                          />
                          <TenantMemberDeleteButton
                            tenantId={tenantId}
                            userId={member.userId}
                          />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              <PaginationControls
                aria-label={t("platform.tenants.members_pagination_aria")}
                nextHref={membersNextHref}
                previousHref={membersPreviousHref}
              />
            </>
          )}
        </TenantMemberRemovals.Root>
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                <Message message="platform.tenants.add_member" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.add_member_description" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        <ActionForm.Root action={addTenantMemberAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="platform.tenants.add_member_email" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                name="member_email"
                placeholder="member@example.com"
                required
                type="email"
              />
            </Field.Content>
          </Field.Root>
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.common.role" />
              </Suspense>
            </Field.Label>
            <Field.Content>
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
            </Field.Content>
          </Field.Root>
          <div className="flex justify-end">
            <ActionForm.Submit variant="outline">
              <ActionForm.Idle>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.tenants.add_member_submit" />
                </Suspense>
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.tenants.add_member_pending" />
                </Suspense>
              </ActionForm.Pending>
            </ActionForm.Submit>
          </div>
        </ActionForm.Root>
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                <Message message="platform.tenants.invitations_title" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="platform.tenants.invitations_description" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        {/* A failed fetch still hands an empty `invitations` array. Keeping the
            table header and the pager next to the error reads as "there are no
            invitations", so the error replaces the whole list. */}
        {invitationErrorMessage ? (
          <SectionError.Root>
            <SectionError.Heading>
              <SectionError.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="platform.tenants.invitations_load_failed" />
                </Suspense>
              </SectionError.Title>
              <SectionError.Description>
                {invitationErrorMessage}
              </SectionError.Description>
            </SectionError.Heading>
          </SectionError.Root>
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
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
  );
};
