"use client";

import { formatMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
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
  createContext,
  useActionState,
  useCallback,
  useContext,
  useState,
  useTransition,
} from "react";

import { useClientMessages } from "#components/client-message";
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

export interface TenantMembersManagerCopy {
  addDescription: string;
  addEmailLabel: string;
  addPending: string;
  addSubmit: string;
  addTitle: string;
  cancel: string;
  cancelInvite: string;
  cancelInviteAction: string;
  cancelInviteDescription: string;
  cancelInvitePending: string;
  cancelInviteTitle: string;
  changeRole: string;
  changeRoleSubmit: string;
  changeRoleUpdating: string;
  deleteMember: string;
  deleteMemberAction: string;
  deleteMemberDescription: string;
  deleteMemberPending: string;
  deleteMemberTitle: string;
  invitationStatusLabels: Record<string, string>;
  invitationsAria: string;
  invitationsDescription: string;
  invitationsEmpty: string;
  invitationsLoadFailed: string;
  invitationsTitle: string;
  inviteAdmin: string;
  inviteAdminDescription: string;
  inviteAdminEmail: string;
  inviteAdminPending: string;
  inviteAdminTitle: string;
  membersAria: string;
  membersColumnsActions: string;
  membersColumnsCreated: string;
  membersColumnsEmail: string;
  membersColumnsExpires: string;
  membersColumnsInvitedAt: string;
  membersColumnsName: string;
  membersColumnsRole: string;
  membersColumnsStatus: string;
  membersEmpty: string;
  membersListDescription: string;
  membersListFailed: string;
  membersListTitle: string;
  newRole: string;
  next: string;
  previous: string;
  resendInvite: string;
  role: string;
  roleLabels: Record<string, string>;
  roleOptions: { label: string; value: string }[];
  roleUpdateDescription: string;
  statusLabels: Record<string, string>;
  unset: string;
}

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

/**
 * The whole copy bag this manager renders, read from the catalog here rather
 * than handed in: an accessor travelling as an argument would make every key
 * below an attribute of whatever the caller happened to bind.
 */
const useTenantMembersCopy = (): TenantMembersManagerCopy => {
  const t = useClientMessages();

  return {
    addDescription: t("platform.tenants.add_member_description"),
    addEmailLabel: t("platform.tenants.add_member_email"),
    addPending: t("platform.tenants.add_member_pending"),
    addSubmit: t("platform.tenants.add_member_submit"),
    addTitle: t("platform.tenants.add_member"),
    cancel: t("platform.common.cancel"),
    cancelInvite: t("platform.tenants.cancel_invite"),
    cancelInviteAction: t("platform.tenants.cancel_invite_action"),
    cancelInviteDescription: t("platform.tenants.cancel_invite_description"),
    cancelInvitePending: t("platform.tenants.cancel_invite_pending"),
    cancelInviteTitle: t("platform.tenants.cancel_invite_title"),
    changeRole: t("platform.tenants.change_role"),
    changeRoleSubmit: t("platform.tenants.change_role_submit"),
    changeRoleUpdating: t("platform.tenants.change_role_updating"),
    deleteMember: t("platform.tenants.delete_member"),
    deleteMemberAction: t("platform.tenants.delete_member_action"),
    deleteMemberDescription: t("platform.tenants.delete_member_description"),
    deleteMemberPending: t("platform.tenants.delete_member_pending"),
    deleteMemberTitle: t("platform.tenants.delete_member_title"),
    invitationStatusLabels: {
      accepted: t("platform.common.invitation_status.accepted"),
      canceled: t("platform.common.invitation_status.canceled"),
      expired: t("platform.common.invitation_status.expired"),
      pending: t("platform.common.invitation_status.pending"),
    },
    invitationsAria: t("platform.tenants.invitations_pagination_aria"),
    invitationsDescription: t("platform.tenants.invitations_description"),
    invitationsEmpty: t("platform.tenants.invitations_empty"),
    invitationsLoadFailed: t("platform.tenants.invitations_load_failed"),
    invitationsTitle: t("platform.tenants.invitations_title"),
    inviteAdmin: t("platform.tenants.invite_admin"),
    inviteAdminDescription: t("platform.tenants.invite_admin_description"),
    inviteAdminEmail: t("platform.tenants.invite_admin_email"),
    inviteAdminPending: t("platform.tenants.invite_admin_pending"),
    inviteAdminTitle: t("platform.tenants.invite_admin_title"),
    membersAria: t("platform.tenants.members_pagination_aria"),
    membersColumnsActions: t("platform.tenants.members_columns_actions"),
    membersColumnsCreated: t("platform.tenants.members_columns_created"),
    membersColumnsEmail: t("platform.tenants.members_columns_email"),
    membersColumnsExpires: t("platform.tenants.members_columns_expires"),
    membersColumnsInvitedAt: t("platform.tenants.members_columns_invited_at"),
    membersColumnsName: t("platform.tenants.members_columns_name"),
    membersColumnsRole: t("platform.tenants.members_columns_role"),
    membersColumnsStatus: t("platform.tenants.members_columns_status"),
    membersEmpty: t("platform.tenants.members_empty"),
    membersListDescription: t("platform.tenants.members_list_description"),
    membersListFailed: t("platform.tenants.members_load_failed"),
    membersListTitle: t("platform.tenants.members_list_title"),
    newRole: t("platform.tenants.new_role"),
    next: t("platform.common.next"),
    previous: t("platform.common.previous"),
    resendInvite: t("platform.tenants.resend_invite"),
    role: t("platform.common.role"),
    roleLabels: {
      tenant_admin: t("platform.common.roles.tenant_admin"),
      tenant_auditor: t("platform.common.roles.tenant_auditor"),
      tenant_editor: t("platform.common.roles.tenant_editor"),
      tenant_member: t("platform.common.roles.tenant_member"),
      tenant_owner: t("platform.common.roles.tenant_owner"),
    },
    roleOptions: [
      {
        label: t("platform.common.roles.tenant_admin"),
        value: "tenant_admin",
      },
      {
        label: t("platform.common.roles.tenant_editor"),
        value: "tenant_editor",
      },
      {
        label: t("platform.common.roles.tenant_auditor"),
        value: "tenant_auditor",
      },
    ],
    roleUpdateDescription: t("platform.tenants.role_update_description"),
    statusLabels: {
      active: t("platform.common.account_status.active"),
      inactive: t("platform.common.account_status.inactive"),
      suspended: t("platform.common.account_status.suspended"),
    },
    unset: t("platform.common.unset"),
  };
};

const TenantMembersLabelsContext =
  createContext<TenantMembersManagerCopy | null>(null);

const useTenantMembersLabels = () => {
  const labels = useContext(TenantMembersLabelsContext);
  if (!labels) {
    throw new Error("TenantMembersLabelsContext is missing");
  }
  return labels;
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
  isCancelPending: boolean;
  isResendPending: boolean;
  locale: Locale;
  onCancel: (invitationId: string) => void;
  onResend: (invitationId: string) => void;
  timeZone: string;
}

const TenantMemberDeleteButton = ({
  removeAction,
  setDeleteState,
  tenantId,
  userPublicId,
}: TenantMemberDeleteButtonProps) => {
  const copy = useTenantMembersLabels();
  const [isPending, startTransition] = useTransition();

  const handleDelete = useCallback(() => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("tenant_id", tenantId);
      formData.set("member_user_public_id", userPublicId);

      const state = await removeAction(null, formData);
      setDeleteState(state);
    });
  }, [removeAction, setDeleteState, tenantId, userPublicId]);

  return (
    <ConfirmDialog>
      <ConfirmDialogTrigger
        render={
          <Button
            disabled={isPending}
            size="sm"
            type="button"
            variant="destructive"
          >
            {copy.deleteMember}
          </Button>
        }
      />
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{copy.deleteMemberTitle}</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {copy.deleteMemberDescription}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>{copy.cancel}</ConfirmDialogCancel>
          <ConfirmDialogAction onClick={handleDelete}>
            {isPending ? copy.deleteMemberPending : copy.deleteMemberAction}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
};

const TenantMemberRoleDialog = ({
  member,
  tenantId,
  updateRoleAction,
}: TenantMemberRoleDialogProps) => {
  const copy = useTenantMembersLabels();
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
            {copy.changeRole}
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
                  {copy.changeRoleSubmit}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {formatMessage(copy.roleUpdateDescription, {
                    email: member.email,
                    name: member.name,
                  })}
                </DialogDescription>
              </DialogHeader>

              <Field>
                <FieldLabel required>{copy.newRole}</FieldLabel>
                <FieldContent>
                  <div className="flex flex-wrap gap-2">
                    {copy.roleOptions.map((roleOption) => (
                      <label
                        key={roleOption.value}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-input bg-background px-3 py-2 text-sm text-foreground"
                      >
                        <input
                          defaultChecked={member.role === roleOption.value}
                          name="member_role"
                          required
                          type="radio"
                          value={roleOption.value}
                        />
                        <span>{roleOption.label}</span>
                      </label>
                    ))}
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
                      {copy.cancel}
                    </Button>
                  }
                />
                <Button
                  disabled={isRolePending}
                  type="submit"
                  variant="outline"
                >
                  {isRolePending
                    ? copy.changeRoleUpdating
                    : copy.changeRoleSubmit}
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
  const copy = useTenantMembersLabels();

  return (
    <TableRow key={member.userPublicId || member.email}>
      <TableCell>
        <p className="font-medium text-foreground">{member.name}</p>
      </TableCell>
      <TableCell>{member.email}</TableCell>
      <TableCell>{copy.roleLabels[member.role] ?? member.role}</TableCell>
      <TableCell>
        <Badge tone={getEndUserStatusTone(member.status)}>
          {copy.statusLabels[member.status] ?? member.status}
        </Badge>
      </TableCell>
      <TableCell>
        {formatDate(member.createdAt, {
          fallback: copy.unset,
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
  isCancelPending: boolean;
  isResendPending: boolean;
  locale: Locale;
  onCancel: (invitationId: string) => void;
  onResend: (invitationId: string) => void;
  timeZone: string;
}

const TenantInvitationRow = ({
  invitation,
  isCancelPending,
  isResendPending,
  locale,
  onCancel,
  onResend,
  timeZone,
}: TenantInvitationRowProps) => {
  const copy = useTenantMembersLabels();
  const canOperate = invitation.status === "pending";

  const handleResendClick = useCallback(() => {
    onResend(invitation.id);
  }, [invitation.id, onResend]);

  const handleCancelAction = useCallback(() => {
    onCancel(invitation.id);
  }, [invitation.id, onCancel]);

  return (
    <TableRow key={invitation.id}>
      <TableCell>{invitation.email}</TableCell>
      <TableCell>
        <Badge tone={invitationStatusTone(invitation.status)}>
          {copy.invitationStatusLabels[invitation.status] ?? invitation.status}
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
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canOperate || isResendPending || isCancelPending}
            onClick={handleResendClick}
            size="sm"
            type="button"
            variant="outline"
          >
            {copy.resendInvite}
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
                  {copy.cancelInvite}
                </Button>
              }
            />
            <ConfirmDialogContent>
              <ConfirmDialogHeader>
                <ConfirmDialogTitle>
                  {copy.cancelInviteTitle}
                </ConfirmDialogTitle>
                <ConfirmDialogDescription>
                  {copy.cancelInviteDescription}
                </ConfirmDialogDescription>
              </ConfirmDialogHeader>
              <ConfirmDialogFooter>
                <ConfirmDialogCancel>{copy.cancel}</ConfirmDialogCancel>
                <ConfirmDialogAction onClick={handleCancelAction}>
                  {isCancelPending
                    ? copy.cancelInvitePending
                    : copy.cancelInviteAction}
                </ConfirmDialogAction>
              </ConfirmDialogFooter>
            </ConfirmDialogContent>
          </ConfirmDialog>
        </div>
      </TableCell>
    </TableRow>
  );
};

const TenantInvitationsSection = ({
  invitationErrorMessage,
  invitations,
  invitationsNextHref,
  invitationsPreviousHref,
  isCancelPending,
  isResendPending,
  locale,
  onCancel,
  onResend,
  timeZone,
}: TenantInvitationsSectionProps) => {
  const copy = useTenantMembersLabels();
  // A failed fetch still hands an empty `invitations` array. Keeping the table
  // header and the pager next to the error reads as "there are no invitations",
  // so the error replaces the whole list instead of sitting on top of it.
  if (invitationErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>{copy.invitationsLoadFailed}</SectionErrorTitle>
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
            <TableHead>{copy.membersColumnsEmail}</TableHead>
            <TableHead>{copy.membersColumnsStatus}</TableHead>
            <TableHead>{copy.membersColumnsInvitedAt}</TableHead>
            <TableHead>{copy.membersColumnsExpires}</TableHead>
            <TableHead className="w-56">{copy.membersColumnsActions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.length === 0 ? (
            <TableRow>
              <TableCell className="text-muted-foreground" colSpan={5}>
                {copy.invitationsEmpty}
              </TableCell>
            </TableRow>
          ) : null}

          {invitations.map((invitation) => (
            <TenantInvitationRow
              invitation={invitation}
              isCancelPending={isCancelPending}
              isResendPending={isResendPending}
              key={invitation.id}
              locale={locale}
              onCancel={onCancel}
              onResend={onResend}
              timeZone={timeZone}
            />
          ))}
        </TableBody>
      </Table>

      <PaginationControls
        ariaLabel={copy.invitationsAria}
        nextHref={invitationsNextHref}
        nextLabel={copy.next}
        previousHref={invitationsPreviousHref}
        previousLabel={copy.previous}
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
  const copy = useTenantMembersCopy();
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
  const [isCancelPending, startCancelTransition] = useTransition();

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
    (invitationId: string) => {
      startCancelTransition(async () => {
        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("invitation_id", invitationId);
        const state = await cancelInvitationAction(null, formData);
        setInvitationActionState(state);
      });
    },
    [cancelInvitationAction, tenantId]
  );

  return (
    <TenantMembersLabelsContext value={copy}>
      <PlatformSections>
        <PlatformSection>
          <PlatformSectionHeader>
            <PlatformSectionHeading>
              <PlatformSectionTitle>
                {copy.inviteAdminTitle}
              </PlatformSectionTitle>
              <PlatformSectionDescription>
                {copy.inviteAdminDescription}
              </PlatformSectionDescription>
            </PlatformSectionHeading>
          </PlatformSectionHeader>
          <form action={createInviteAction} className="grid gap-4">
            <input name="tenant_id" type="hidden" value={tenantId} />
            <Field>
              <FieldLabel required>{copy.inviteAdminEmail}</FieldLabel>
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
              <Button
                disabled={isInvitePending}
                type="submit"
                variant="outline"
              >
                {isInvitePending ? copy.inviteAdminPending : copy.inviteAdmin}
              </Button>
            </div>
          </form>
        </PlatformSection>

        <PlatformSection>
          <PlatformSectionHeader>
            <PlatformSectionHeading>
              <PlatformSectionTitle>
                {copy.membersListTitle}
              </PlatformSectionTitle>
              <PlatformSectionDescription>
                {copy.membersListDescription}
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
                <SectionErrorTitle>{copy.membersListFailed}</SectionErrorTitle>
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
                    <TableHead>{copy.membersColumnsName}</TableHead>
                    <TableHead>{copy.membersColumnsEmail}</TableHead>
                    <TableHead>{copy.membersColumnsRole}</TableHead>
                    <TableHead>{copy.membersColumnsStatus}</TableHead>
                    <TableHead>{copy.membersColumnsCreated}</TableHead>
                    <TableHead className="w-56">
                      {copy.membersColumnsActions}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground" colSpan={6}>
                        {copy.membersEmpty}
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
                ariaLabel={copy.membersAria}
                nextHref={membersNextHref}
                nextLabel={copy.next}
                previousHref={membersPreviousHref}
                previousLabel={copy.previous}
              />
            </>
          )}
        </PlatformSection>

        <PlatformSection>
          <PlatformSectionHeader>
            <PlatformSectionHeading>
              <PlatformSectionTitle>{copy.addTitle}</PlatformSectionTitle>
              <PlatformSectionDescription>
                {copy.addDescription}
              </PlatformSectionDescription>
            </PlatformSectionHeading>
          </PlatformSectionHeader>
          <form action={addFormAction} className="grid gap-4">
            <input name="tenant_id" type="hidden" value={tenantId} />
            <Field>
              <FieldLabel required>{copy.addEmailLabel}</FieldLabel>
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
              <FieldLabel required>{copy.role}</FieldLabel>
              <FieldContent>
                <Select
                  defaultValue="tenant_admin"
                  items={copy.roleOptions}
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
                {isAddPending ? copy.addPending : copy.addSubmit}
              </Button>
            </div>
          </form>
        </PlatformSection>

        <PlatformSection>
          <PlatformSectionHeader>
            <PlatformSectionHeading>
              <PlatformSectionTitle>
                {copy.invitationsTitle}
              </PlatformSectionTitle>
              <PlatformSectionDescription>
                {copy.invitationsDescription}
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
            isCancelPending={isCancelPending}
            isResendPending={isResendPending}
            locale={locale}
            onCancel={handleCancel}
            onResend={handleResend}
            timeZone={timeZone}
          />
        </PlatformSection>
      </PlatformSections>
    </TenantMembersLabelsContext>
  );
};
