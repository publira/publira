"use client";

import type { Locale } from "@publira/i18n";
import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
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
  Dialog,
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
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDate, formatDateTime } from "@publira/utils";
import {
  useActionState,
  useCallback,
  useId,
  useState,
  useTransition,
} from "react";
import type { ReactNode } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { PaginationControls } from "#components/pagination-controls";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSections,
  PlatformSectionTitle,
} from "#components/platform-page";
import type {
  PlatformTenantAdminInvitation,
  PlatformTenantMemberSummary,
} from "#lib/tenants";
import { getEndUserStatusTone } from "#lib/user-labels";

interface TenantMembersManagerProps {
  addAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  cancelInvitationAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  createInvitationAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  invitationErrorMessage?: string;
  invitations: PlatformTenantAdminInvitation[];
  invitationsNextHref?: string;
  invitationsPreviousHref?: string;
  locale: Locale;
  members: PlatformTenantMemberSummary[];
  membersErrorMessage?: string;
  membersNextHref?: string;
  membersPreviousHref?: string;
  removeAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  resendInvitationAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  tenantId: string;
  timeZone: string;
  updateRoleAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
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

interface TenantMemberRowProps {
  locale: Locale;
  member: PlatformTenantMemberSummary;
  removeAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  setDeleteState: (state: FormActionState) => void;
  tenantId: string;
  timeZone: string;
  updateRoleAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
}

interface TenantMemberRoleDialogProps {
  member: PlatformTenantMemberSummary;
  tenantId: string;
  updateRoleAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
}

interface TenantMemberDeleteButtonProps {
  removeAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  setDeleteState: (state: FormActionState) => void;
  tenantId: string;
  userPublicId: string;
}

interface TenantInvitationRowProps {
  invitation: PlatformTenantAdminInvitation;
  isResendPending: boolean;
  locale: Locale;
  onCancel: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  onResend: (invitationId: string) => void;
  tenantId: string;
  timeZone: string;
}

/** A member's role, worded for the operator; an unknown role shows as stored. */
const TenantRoleLabel = ({ role }: { role: string }) => {
  switch (role) {
    case "tenant_admin": {
      return <ClientMessage message="platform.common.roles.tenant_admin" />;
    }
    case "tenant_auditor": {
      return <ClientMessage message="platform.common.roles.tenant_auditor" />;
    }
    case "tenant_editor": {
      return <ClientMessage message="platform.common.roles.tenant_editor" />;
    }
    case "tenant_member": {
      return <ClientMessage message="platform.common.roles.tenant_member" />;
    }
    case "tenant_owner": {
      return <ClientMessage message="platform.common.roles.tenant_owner" />;
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
      return <ClientMessage message="platform.common.account_status.active" />;
    }
    case "inactive": {
      return (
        <ClientMessage message="platform.common.account_status.inactive" />
      );
    }
    case "suspended": {
      return (
        <ClientMessage message="platform.common.account_status.suspended" />
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
        <ClientMessage message="platform.common.invitation_status.accepted" />
      );
    }
    case "canceled": {
      return (
        <ClientMessage message="platform.common.invitation_status.canceled" />
      );
    }
    case "expired": {
      return (
        <ClientMessage message="platform.common.invitation_status.expired" />
      );
    }
    case "pending": {
      return (
        <ClientMessage message="platform.common.invitation_status.pending" />
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

const TenantMemberDeleteButton = ({
  removeAction,
  setDeleteState,
  tenantId,
  userPublicId,
}: TenantMemberDeleteButtonProps) => {
  const formId = useId();
  const [, formAction, isPending] = useActionState(
    async (
      previousState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      const state = await removeAction(previousState, formData);
      setDeleteState(state);
      return state;
    },
    null
  );

  return (
    <form action={formAction} id={formId}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="member_user_public_id" type="hidden" value={userPublicId} />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant="destructive"
            >
              <ActionFormIdle>
                <ClientMessage message="platform.tenants.delete_member" />
              </ActionFormIdle>
              <ActionFormPending>
                <ClientMessage message="platform.tenants.delete_member_pending" />
              </ActionFormPending>
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <ClientMessage message="platform.tenants.delete_member_title" />
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <ClientMessage message="platform.tenants.delete_member_description" />
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <ClientMessage message="platform.common.cancel" />
            </ConfirmDialogCancel>
            <ConfirmDialogAction form={formId}>
              <ClientMessage message="platform.tenants.delete_member_action" />
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </form>
  );
};

const TenantMemberRoleDialog = ({
  member,
  tenantId,
  updateRoleAction,
}: TenantMemberRoleDialogProps) => {
  const [open, setOpen] = useState(false);
  // Submitting is what closes the dialog: the role is saved, so the form the
  // operator was filling in has nothing left to show.
  const [updateState, roleFormAction, isRolePending] = useActionState(
    async (
      previousState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      const nextState = await updateRoleAction(previousState, formData);
      if (nextState?.ok) {
        setOpen(false);
      }
      return nextState;
    },
    null
  );

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button size="sm" type="button" variant="outline">
            <ClientMessage message="platform.tenants.change_role" />
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup>
            <form action={roleFormAction} className="grid gap-4">
              <input name="tenant_id" type="hidden" value={tenantId} />
              <input
                name="member_user_public_id"
                type="hidden"
                value={member.userPublicId}
              />

              <DialogHeader>
                <DialogTitle className="text-lg font-semibold">
                  <ClientMessage message="platform.tenants.change_role_submit" />
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  <ClientMessage
                    message="platform.tenants.role_update_description"
                    values={{ email: member.email, name: member.name }}
                  />
                </DialogDescription>
              </DialogHeader>

              <Field>
                <FieldLabel required>
                  <ClientMessage message="platform.tenants.new_role" />
                </FieldLabel>
                <FieldContent>
                  <div className="flex flex-wrap gap-2">
                    <TenantRoleRadio
                      defaultChecked={member.role === "tenant_admin"}
                      value="tenant_admin"
                    >
                      <ClientMessage message="platform.common.roles.tenant_admin" />
                    </TenantRoleRadio>
                    <TenantRoleRadio
                      defaultChecked={member.role === "tenant_editor"}
                      value="tenant_editor"
                    >
                      <ClientMessage message="platform.common.roles.tenant_editor" />
                    </TenantRoleRadio>
                    <TenantRoleRadio
                      defaultChecked={member.role === "tenant_auditor"}
                      value="tenant_auditor"
                    >
                      <ClientMessage message="platform.common.roles.tenant_auditor" />
                    </TenantRoleRadio>
                  </div>
                </FieldContent>
              </Field>

              {updateState ? (
                <FormMessage
                  variant={updateState.ok ? "success" : "destructive"}
                >
                  {updateState.message}
                </FormMessage>
              ) : null}

              <DialogFooter>
                <DialogClose
                  render={
                    <Button type="button" variant="outline">
                      <ClientMessage message="platform.common.cancel" />
                    </Button>
                  }
                />
                <Button
                  disabled={isRolePending}
                  type="submit"
                  variant="outline"
                >
                  <ActionFormIdle>
                    <ClientMessage message="platform.tenants.change_role_submit" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <ClientMessage message="platform.tenants.change_role_updating" />
                  </ActionFormPending>
                </Button>
              </DialogFooter>
            </form>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};

const TenantMemberRow = ({
  locale,
  member,
  removeAction,
  setDeleteState,
  tenantId,
  timeZone,
  updateRoleAction,
}: TenantMemberRowProps) => {
  const t = useClientMessages();

  return (
    <TableRow key={member.userPublicId || member.email}>
      <TableCell>
        <p className="font-medium text-foreground">{member.name}</p>
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
        <div className="flex flex-wrap gap-2">
          <TenantMemberRoleDialog
            member={member}
            tenantId={tenantId}
            updateRoleAction={updateRoleAction}
          />
          <TenantMemberDeleteButton
            removeAction={removeAction}
            setDeleteState={setDeleteState}
            tenantId={tenantId}
            userPublicId={member.userPublicId}
          />
        </div>
      </TableCell>
    </TableRow>
  );
};

interface TenantInvitationsSectionProps {
  invitationErrorMessage?: string;
  invitations: PlatformTenantAdminInvitation[];
  invitationsNextHref?: string;
  invitationsPreviousHref?: string;
  isResendPending: boolean;
  locale: Locale;
  onCancel: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  onResend: (invitationId: string) => void;
  tenantId: string;
  timeZone: string;
}

const TenantInvitationRow = ({
  invitation,
  isResendPending,
  locale,
  onCancel,
  onResend,
  tenantId,
  timeZone,
}: TenantInvitationRowProps) => {
  const canOperate = invitation.status === "pending";
  const formId = useId();
  const [, cancelFormAction, isCancelPending] = useActionState(onCancel, null);

  const handleResendClick = useCallback(() => {
    onResend(invitation.id);
  }, [invitation.id, onResend]);

  return (
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
        <form
          action={cancelFormAction}
          className="flex flex-wrap gap-2"
          id={formId}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="invitation_id" type="hidden" value={invitation.id} />
          <Button
            disabled={!canOperate || isResendPending || isCancelPending}
            onClick={handleResendClick}
            size="sm"
            type="button"
            variant="outline"
          >
            <ClientMessage message="platform.tenants.resend_invite" />
          </Button>
          <ConfirmDialog>
            <ConfirmDialogTrigger
              render={
                <Button
                  disabled={!canOperate || isCancelPending || isResendPending}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  <ActionFormIdle>
                    <ClientMessage message="platform.tenants.cancel_invite" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <ClientMessage message="platform.tenants.cancel_invite_pending" />
                  </ActionFormPending>
                </Button>
              }
            />
            <ConfirmDialogContent>
              <ConfirmDialogHeader>
                <ConfirmDialogTitle>
                  <ClientMessage message="platform.tenants.cancel_invite_title" />
                </ConfirmDialogTitle>
                <ConfirmDialogDescription>
                  <ClientMessage message="platform.tenants.cancel_invite_description" />
                </ConfirmDialogDescription>
              </ConfirmDialogHeader>
              <ConfirmDialogFooter>
                <ConfirmDialogCancel>
                  <ClientMessage message="platform.common.cancel" />
                </ConfirmDialogCancel>
                <ConfirmDialogAction form={formId}>
                  <ClientMessage message="platform.tenants.cancel_invite_action" />
                </ConfirmDialogAction>
              </ConfirmDialogFooter>
            </ConfirmDialogContent>
          </ConfirmDialog>
        </form>
      </TableCell>
    </TableRow>
  );
};

const TenantInvitationsSection = ({
  invitationErrorMessage,
  invitations,
  invitationsNextHref,
  invitationsPreviousHref,
  isResendPending,
  locale,
  onCancel,
  onResend,
  tenantId,
  timeZone,
}: TenantInvitationsSectionProps) => {
  const t = useClientMessages();
  // A failed fetch still hands an empty `invitations` array. Keeping the table
  // header and the pager next to the error reads as "there are no invitations",
  // so the error replaces the whole list instead of sitting on top of it.
  if (invitationErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <ClientMessage message="platform.tenants.invitations_load_failed" />
          </SectionErrorTitle>
          <SectionErrorDescription>
            {invitationErrorMessage}
          </SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <ClientMessage message="platform.tenants.members_columns_email" />
            </TableHead>
            <TableHead>
              <ClientMessage message="platform.tenants.members_columns_status" />
            </TableHead>
            <TableHead>
              <ClientMessage message="platform.tenants.members_columns_invited_at" />
            </TableHead>
            <TableHead>
              <ClientMessage message="platform.tenants.members_columns_expires" />
            </TableHead>
            <TableHead className="w-56">
              <ClientMessage message="platform.tenants.members_columns_actions" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.length === 0 ? (
            <TableRow>
              <TableCell className="text-muted-foreground" colSpan={5}>
                <ClientMessage message="platform.tenants.invitations_empty" />
              </TableCell>
            </TableRow>
          ) : null}

          {invitations.map((invitation) => (
            <TenantInvitationRow
              invitation={invitation}
              isResendPending={isResendPending}
              key={invitation.id}
              locale={locale}
              onCancel={onCancel}
              onResend={onResend}
              tenantId={tenantId}
              timeZone={timeZone}
            />
          ))}
        </TableBody>
      </Table>

      <PaginationControls
        aria-label={t("platform.tenants.invitations_pagination_aria")}
        nextHref={invitationsNextHref}
        previousHref={invitationsPreviousHref}
      />
    </>
  );
};

export const TenantMembersManager = ({
  addAction,
  cancelInvitationAction,
  createInvitationAction,
  invitationErrorMessage,
  invitations,
  invitationsNextHref,
  invitationsPreviousHref,
  locale,
  members,
  membersErrorMessage,
  membersNextHref,
  membersPreviousHref,
  removeAction,
  resendInvitationAction,
  tenantId,
  timeZone,
  updateRoleAction,
}: TenantMembersManagerProps) => {
  const t = useClientMessages();
  const [addState, addFormAction, isAddPending] = useActionState(
    addAction,
    null
  );
  const [inviteState, createInviteAction, isInvitePending] = useActionState(
    createInvitationAction,
    null
  );
  const [invitationActionState, setInvitationActionState] =
    useState<FormActionState>(null);
  const [deleteState, setDeleteState] = useState<FormActionState>(null);

  const [isResendPending, startResendTransition] = useTransition();

  const handleResend = useCallback(
    (invitationId: string) => {
      startResendTransition(async () => {
        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("invitation_id", invitationId);
        const state = await resendInvitationAction(null, formData);
        setInvitationActionState(state);
      });
    },
    [resendInvitationAction, tenantId]
  );

  const handleCancel = useCallback(
    async (
      previousState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      const state = await cancelInvitationAction(previousState, formData);
      setInvitationActionState(state);
      return state;
    },
    [cancelInvitationAction]
  );

  return (
    <PlatformSections>
      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <ClientMessage message="platform.tenants.invite_admin_title" />
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <ClientMessage message="platform.tenants.invite_admin_description" />
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        <form action={createInviteAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <Field>
            <FieldLabel required>
              <ClientMessage message="platform.tenants.invite_admin_email" />
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

          {inviteState ? (
            <FormMessage variant={inviteState.ok ? "success" : "destructive"}>
              {inviteState.message}
            </FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isInvitePending} type="submit" variant="outline">
              <ActionFormIdle>
                <ClientMessage message="platform.tenants.invite_admin" />
              </ActionFormIdle>
              <ActionFormPending>
                <ClientMessage message="platform.tenants.invite_admin_pending" />
              </ActionFormPending>
            </Button>
          </div>
        </form>
      </PlatformSection>

      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <ClientMessage message="platform.tenants.members_list_title" />
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <ClientMessage message="platform.tenants.members_list_description" />
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        {deleteState ? (
          <FormMessage variant={deleteState.ok ? "success" : "destructive"}>
            {deleteState.message}
          </FormMessage>
        ) : null}
        {membersErrorMessage ? (
          <SectionError>
            <SectionErrorHeading>
              <SectionErrorTitle>
                <ClientMessage message="platform.tenants.members_load_failed" />
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
                    <ClientMessage message="platform.tenants.members_columns_name" />
                  </TableHead>
                  <TableHead>
                    <ClientMessage message="platform.tenants.members_columns_email" />
                  </TableHead>
                  <TableHead>
                    <ClientMessage message="platform.tenants.members_columns_role" />
                  </TableHead>
                  <TableHead>
                    <ClientMessage message="platform.tenants.members_columns_status" />
                  </TableHead>
                  <TableHead>
                    <ClientMessage message="platform.tenants.members_columns_created" />
                  </TableHead>
                  <TableHead className="w-56">
                    <ClientMessage message="platform.tenants.members_columns_actions" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={6}>
                      <ClientMessage message="platform.tenants.members_empty" />
                    </TableCell>
                  </TableRow>
                ) : null}
                {members.map((member) => (
                  <TenantMemberRow
                    key={member.userPublicId || member.email}
                    locale={locale}
                    member={member}
                    removeAction={removeAction}
                    setDeleteState={setDeleteState}
                    tenantId={tenantId}
                    timeZone={timeZone}
                    updateRoleAction={updateRoleAction}
                  />
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
      </PlatformSection>

      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <ClientMessage message="platform.tenants.add_member" />
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <ClientMessage message="platform.tenants.add_member_description" />
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        <form action={addFormAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <Field>
            <FieldLabel required>
              <ClientMessage message="platform.tenants.add_member_email" />
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
              <ClientMessage message="platform.common.role" />
            </FieldLabel>
            <FieldContent>
              <Select
                defaultValue="tenant_admin"
                items={[
                  {
                    label: (
                      <ClientMessage message="platform.common.roles.tenant_admin" />
                    ),
                    value: "tenant_admin",
                  },
                  {
                    label: (
                      <ClientMessage message="platform.common.roles.tenant_editor" />
                    ),
                    value: "tenant_editor",
                  },
                  {
                    label: (
                      <ClientMessage message="platform.common.roles.tenant_auditor" />
                    ),
                    value: "tenant_auditor",
                  },
                ]}
                name="member_role"
                required
              />
            </FieldContent>
          </Field>
          {addState ? (
            <FormMessage variant={addState.ok ? "success" : "destructive"}>
              {addState.message}
            </FormMessage>
          ) : null}
          <div className="flex justify-end">
            <Button disabled={isAddPending} type="submit" variant="outline">
              <ActionFormIdle>
                <ClientMessage message="platform.tenants.add_member_submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <ClientMessage message="platform.tenants.add_member_pending" />
              </ActionFormPending>
            </Button>
          </div>
        </form>
      </PlatformSection>

      <PlatformSection>
        <PlatformSectionHeader>
          <PlatformSectionHeading>
            <PlatformSectionTitle>
              <ClientMessage message="platform.tenants.invitations_title" />
            </PlatformSectionTitle>
            <PlatformSectionDescription>
              <ClientMessage message="platform.tenants.invitations_description" />
            </PlatformSectionDescription>
          </PlatformSectionHeading>
        </PlatformSectionHeader>
        {invitationActionState ? (
          <FormMessage
            variant={invitationActionState.ok ? "success" : "destructive"}
          >
            {invitationActionState.message}
          </FormMessage>
        ) : null}

        <TenantInvitationsSection
          invitationErrorMessage={invitationErrorMessage}
          invitations={invitations}
          invitationsNextHref={invitationsNextHref}
          invitationsPreviousHref={invitationsPreviousHref}
          isResendPending={isResendPending}
          locale={locale}
          onCancel={handleCancel}
          onResend={handleResend}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      </PlatformSection>
    </PlatformSections>
  );
};
