"use client";

import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  ConfirmDialog,
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
import { Select } from "@publira/ui-components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import * as React from "react";
import { useActionState } from "react";

import {
  getTenantRoleLabel,
  getTenantStatusLabel,
  getTenantStatusTone,
} from "../../../../../../lib/tenant-labels";
import type {
  PlatformTenantAdminInvitation,
  PlatformTenantMemberSummary,
} from "../../../../../../lib/tenants";
import type {
  TenantInvitationFormState,
  TenantMemberFormState,
} from "../../_lib/actions";

const tenantRoleOptions = [
  { label: "テナント管理者", value: "tenant_admin" },
  { label: "編集担当", value: "tenant_editor" },
  { label: "監査担当", value: "tenant_auditor" },
] as const;

interface TenantMembersManagerProps {
  addAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  cancelInvitationAction: (
    prevState: TenantInvitationFormState,
    formData: FormData
  ) => Promise<TenantInvitationFormState>;
  createInvitationAction: (
    prevState: TenantInvitationFormState,
    formData: FormData
  ) => Promise<TenantInvitationFormState>;
  invitations: PlatformTenantAdminInvitation[];
  members: PlatformTenantMemberSummary[];
  removeAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  resendInvitationAction: (
    prevState: TenantInvitationFormState,
    formData: FormData
  ) => Promise<TenantInvitationFormState>;
  tenantPublicId: string;
  updateRoleAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
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

const invitationStatusLabel = (status: string) => {
  if (status === "pending") {
    return "招待中";
  }
  if (status === "accepted") {
    return "承諾済み";
  }
  if (status === "expired") {
    return "期限切れ";
  }
  if (status === "canceled") {
    return "取り消し";
  }
  return status;
};

interface TenantMemberRowProps {
  member: PlatformTenantMemberSummary;
  removeAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  setDeleteState: (state: TenantMemberFormState) => void;
  tenantPublicId: string;
  updateRoleAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
}

interface TenantMemberRoleDialogProps {
  member: PlatformTenantMemberSummary;
  tenantPublicId: string;
  updateRoleAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
}

interface TenantMemberDeleteButtonProps {
  removeAction: (
    prevState: TenantMemberFormState,
    formData: FormData
  ) => Promise<TenantMemberFormState>;
  setDeleteState: (state: TenantMemberFormState) => void;
  tenantPublicId: string;
  userPublicId: string;
}

const TenantMemberDeleteButton = ({
  removeAction,
  setDeleteState,
  tenantPublicId,
  userPublicId,
}: TenantMemberDeleteButtonProps) => {
  const [isPending, startTransition] = React.useTransition();

  const handleDelete = React.useCallback(() => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("tenant_public_id", tenantPublicId);
      formData.set("member_user_public_id", userPublicId);

      const state = await removeAction(null, formData);
      setDeleteState(state);
    });
  }, [removeAction, setDeleteState, tenantPublicId, userPublicId]);

  return (
    <ConfirmDialog
      actionText={isPending ? "削除中..." : "削除する"}
      actionVariant="destructive"
      description="削除したメンバーはこのテナントへのアクセス権を失います。必要に応じて再追加できます。"
      onAction={handleDelete}
      title="このメンバーを削除しますか？"
      trigger={
        <Button
          disabled={isPending}
          size="sm"
          type="button"
          variant="destructive"
        >
          削除
        </Button>
      }
    />
  );
};

const TenantMemberRoleDialog = ({
  member,
  tenantPublicId,
  updateRoleAction,
}: TenantMemberRoleDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [updateState, roleFormAction, isRolePending] = useActionState(
    updateRoleAction,
    null
  );

  React.useEffect(() => {
    if (updateState?.ok) {
      setOpen(false);
    }
  }, [updateState]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button size="sm" type="button" variant="outline">
            ロール変更
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup>
            <form action={roleFormAction} className="grid gap-4">
              <input
                name="tenant_public_id"
                type="hidden"
                value={tenantPublicId}
              />
              <input
                name="member_user_public_id"
                type="hidden"
                value={member.userPublicId}
              />

              <DialogHeader>
                <DialogTitle className="text-lg font-semibold">
                  ロールを変更
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {member.name}（{member.email}）のロールを更新します。
                </DialogDescription>
              </DialogHeader>

              <Field>
                <FieldLabel required>新しいロール</FieldLabel>
                <FieldContent>
                  <div className="flex flex-wrap gap-2">
                    {tenantRoleOptions.map((roleOption) => (
                      <label
                        key={roleOption.value}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
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
                      キャンセル
                    </Button>
                  }
                />
                <Button
                  disabled={isRolePending}
                  type="submit"
                  variant="outline"
                >
                  {isRolePending ? "更新中..." : "更新する"}
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
  member,
  removeAction,
  setDeleteState,
  tenantPublicId,
  updateRoleAction,
}: TenantMemberRowProps) => (
  <TableRow key={member.userPublicId || member.email}>
    <TableCell>
      <p className="font-medium text-foreground">{member.name}</p>
    </TableCell>
    <TableCell>{member.email}</TableCell>
    <TableCell>{getTenantRoleLabel(member.role)}</TableCell>
    <TableCell>
      <Badge tone={getTenantStatusTone(member.status)}>
        {getTenantStatusLabel(member.status)}
      </Badge>
    </TableCell>
    <TableCell>{member.createdAt || "未設定"}</TableCell>
    <TableCell>
      <div className="flex flex-wrap gap-2">
        <TenantMemberRoleDialog
          member={member}
          tenantPublicId={tenantPublicId}
          updateRoleAction={updateRoleAction}
        />
        <TenantMemberDeleteButton
          removeAction={removeAction}
          setDeleteState={setDeleteState}
          tenantPublicId={tenantPublicId}
          userPublicId={member.userPublicId}
        />
      </div>
    </TableCell>
  </TableRow>
);

export const TenantMembersManager = ({
  addAction,
  cancelInvitationAction,
  createInvitationAction,
  invitations,
  members,
  removeAction,
  resendInvitationAction,
  tenantPublicId,
  updateRoleAction,
}: TenantMembersManagerProps) => {
  const [addState, addFormAction, isAddPending] = useActionState(
    addAction,
    null
  );
  const [inviteState, createInviteAction, isInvitePending] = useActionState(
    createInvitationAction,
    null
  );
  const [invitationActionState, setInvitationActionState] =
    React.useState<TenantInvitationFormState>(null);
  const [deleteState, setDeleteState] =
    React.useState<TenantMemberFormState>(null);

  const [isResendPending, startResendTransition] = React.useTransition();
  const [isCancelPending, startCancelTransition] = React.useTransition();

  const handleResend = React.useCallback(
    (invitationId: string) => {
      startResendTransition(async () => {
        const formData = new FormData();
        formData.set("tenant_public_id", tenantPublicId);
        formData.set("invitation_id", invitationId);
        const state = await resendInvitationAction(null, formData);
        setInvitationActionState(state);
      });
    },
    [resendInvitationAction, tenantPublicId]
  );

  const handleCancel = React.useCallback(
    (invitationId: string) => {
      startCancelTransition(async () => {
        const formData = new FormData();
        formData.set("tenant_public_id", tenantPublicId);
        formData.set("invitation_id", invitationId);
        const state = await cancelInvitationAction(null, formData);
        setInvitationActionState(state);
      });
    },
    [cancelInvitationAction, tenantPublicId]
  );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>テナント管理者を招待</CardTitle>
          <CardDescription>
            既存ユーザーなら即時に管理者権限を付与し、未登録メールには招待リンクを送信します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createInviteAction} className="grid gap-4">
            <input
              name="tenant_public_id"
              type="hidden"
              value={tenantPublicId}
            />
            <Field>
              <FieldLabel htmlFor="invite_email" required>
                招待するメールアドレス
              </FieldLabel>
              <FieldContent>
                <Input
                  id="invite_email"
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
                {isInvitePending ? "招待中..." : "管理者を招待"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>テナントメンバー一覧</CardTitle>
          <CardDescription>
            このテナントに所属するメンバーの一覧です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deleteState ? (
            <FormMessage
              className="mb-4"
              variant={deleteState.ok ? "success" : "destructive"}
            >
              {deleteState.message}
            </FormMessage>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>氏名</TableHead>
                <TableHead>メール</TableHead>
                <TableHead>ロール</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>参加日</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={6}>
                    メンバーがまだ登録されていません。メールアドレスを指定して追加してください。
                  </TableCell>
                </TableRow>
              ) : null}
              {members.map((member) => (
                <TenantMemberRow
                  key={member.userPublicId || member.email}
                  member={member}
                  removeAction={removeAction}
                  setDeleteState={setDeleteState}
                  tenantPublicId={tenantPublicId}
                  updateRoleAction={updateRoleAction}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>メンバーを追加</CardTitle>
          <CardDescription>
            メールアドレスとロールを指定して新しいメンバーを招待します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={addFormAction} className="grid gap-4">
            <input
              name="tenant_public_id"
              type="hidden"
              value={tenantPublicId}
            />
            <Field>
              <FieldLabel htmlFor="member_email" required>
                追加するユーザーのメールアドレス
              </FieldLabel>
              <FieldContent>
                <Input
                  id="member_email"
                  name="member_email"
                  placeholder="member@example.com"
                  required
                  type="email"
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="member_role" required>
                ロール
              </FieldLabel>
              <FieldContent>
                <Select
                  defaultValue="tenant_admin"
                  id="member_role"
                  items={tenantRoleOptions}
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
                {isAddPending ? "追加中..." : "メンバーを追加"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>管理者招待一覧</CardTitle>
          <CardDescription>
            送信済み招待の状態確認、再送、取り消しができます。承諾済みの招待は承諾後1週間のみ表示されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitationActionState ? (
            <FormMessage
              className="mb-4"
              variant={invitationActionState.ok ? "success" : "destructive"}
            >
              {invitationActionState.message}
            </FormMessage>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>メール</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>作成日時</TableHead>
                <TableHead>有効期限</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={5}>
                    管理者招待はまだありません。
                  </TableCell>
                </TableRow>
              ) : null}

              {invitations.map((invitation) => {
                const canOperate = invitation.status === "pending";
                return (
                  <TableRow key={invitation.id}>
                    <TableCell>{invitation.email}</TableCell>
                    <TableCell>
                      <Badge tone={invitationStatusTone(invitation.status)}>
                        {invitationStatusLabel(invitation.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{invitation.createdAt || "-"}</TableCell>
                    <TableCell>{invitation.expiresAt || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={!canOperate || isResendPending || isCancelPending}
                          onClick={() => handleResend(invitation.id)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          再送
                        </Button>
                        <ConfirmDialog
                          actionText={isCancelPending ? "取り消し中..." : "取り消す"}
                          actionVariant="destructive"
                          description="この招待リンクは無効化され、受諾できなくなります。"
                          onAction={() => handleCancel(invitation.id)}
                          title="この招待を取り消しますか？"
                          trigger={
                            <Button
                              disabled={!canOperate || isCancelPending || isResendPending}
                              size="sm"
                              type="button"
                              variant="destructive"
                            >
                              取り消し
                            </Button>
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
