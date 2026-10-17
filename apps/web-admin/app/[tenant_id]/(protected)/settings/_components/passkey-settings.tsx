import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
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
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import type { FormatDateTimeOptions } from "@publira/utils";
import { Suspense, useId } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";
import type { AdminPasskey } from "#lib/admin-mfa";

import {
  deleteAccountPasskeyAction,
  renameAccountPasskeyAction,
} from "../_lib/mfa-actions";
import { ReportMfaSettingsChange } from "./mfa-settings-outcome";
import {
  AddedPasskeyIdInput,
  PasskeyAddForm,
  PasskeyAdded,
  PasskeyAddition,
  PasskeyNamed,
  SkipPasskeyNaming,
} from "./passkey-addition";
import { PasskeyRegenerateForm } from "./passkey-regeneration";

const PasskeyNameField = ({
  defaultValue,
  form,
}: {
  defaultValue?: string;
  /** The form the field joins from a dialog's portal. */
  form?: string;
}) => (
  <Field>
    <FieldLabel>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.settings.mfa.passkey_name_label" />
      </Suspense>
    </FieldLabel>
    <FieldContent>
      <Input
        autoComplete="off"
        defaultValue={defaultValue}
        form={form}
        name="name"
      />
    </FieldContent>
    <FieldDescription>
      <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
        <Message message="admin.settings.mfa.passkey_name_description" />
      </Suspense>
    </FieldDescription>
  </Field>
);

/**
 * Names one passkey from its row. The form wraps the dialog rather than
 * sitting in its popup, and the field joins it through `form=`, so saving
 * submits a form that is still mounted while the popup is being torn down.
 * The row shows the new name once the list is read again, so success is a
 * toast.
 */
const PasskeyRenameButton = ({
  passkey,
  tenantId,
}: {
  passkey: AdminPasskey;
  tenantId: string;
}) => {
  const formId = useId();

  return (
    <ActionForm
      action={renameAccountPasskeyAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="passkey_id" type="hidden" value={passkey.id} />
      <SettledToast />
      <ActionFormFieldset className="grid">
        <Dialog>
          <DialogTrigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message="admin.settings.mfa.passkey_rename" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.mfa.passkey_name_submitting" />
              </ActionFormPending>
            </Suspense>
          </DialogTrigger>
          <DialogPortal>
            <DialogBackdrop />
            <DialogViewport>
              <DialogPopup>
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold">
                    <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                      <Message message="admin.settings.mfa.passkey_name_title" />
                    </Suspense>
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-4">
                  <PasskeyNameField defaultValue={passkey.name} form={formId} />
                </div>
                <DialogFooter>
                  <DialogClose
                    render={<Button type="button" variant="outline" />}
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.common.cancel" />
                    </Suspense>
                  </DialogClose>
                  <DialogClose form={formId} render={<Button />} type="submit">
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.settings.mfa.passkey_name_submit" />
                    </Suspense>
                  </DialogClose>
                </DialogFooter>
              </DialogPopup>
            </DialogViewport>
          </DialogPortal>
        </Dialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};

/**
 * Removes one passkey, once the operator has confirmed it. The refusal worth
 * reading is the last second factor of an account the tenant requires one
 * of, and it stays on the row. Success is reported to the card instead, since
 * the row is gone, and the card is what drops a batch an earlier addition
 * left on screen once the last factor, and the codes with it, are gone.
 */
const PasskeyRemoveButton = ({
  passkeyId,
  tenantId,
}: {
  passkeyId: string;
  tenantId: string;
}) => {
  const formId = useId();

  return (
    <ActionForm
      action={deleteAccountPasskeyAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="passkey_id" type="hidden" value={passkeyId} />
      <ReportMfaSettingsChange />
      <ActionFormFieldset className="grid">
        <ConfirmDialog>
          <ConfirmDialogTrigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message="admin.settings.mfa.passkey_remove" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.mfa.passkey_removing" />
              </ActionFormPending>
            </Suspense>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.settings.mfa.passkey_remove_confirm_title" />
                </Suspense>
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.mfa.passkey_remove_confirm_description" />
                </Suspense>
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialogCancel>
              <ConfirmDialogAction form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.mfa.passkey_remove_confirm_action" />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};

const PasskeyRow = ({
  dates,
  passkey,
  tenantId,
}: {
  dates: FormatDateTimeOptions;
  passkey: AdminPasskey;
  tenantId: string;
}) => (
  <li className="flex flex-wrap items-start justify-between gap-3 py-3">
    <div className="grid min-w-0 gap-0.5">
      <p className="text-sm font-medium break-words text-foreground">
        {passkey.name || (
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.settings.mfa.passkey_unnamed" />
          </Suspense>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message
            message="admin.settings.mfa.passkey_added_at"
            values={{ date: formatDateTime(passkey.createdAt, dates) }}
          />
          {" · "}
          {passkey.lastUsedAt ? (
            <Message
              message="admin.settings.mfa.passkey_last_used_at"
              values={{ date: formatDateTime(passkey.lastUsedAt, dates) }}
            />
          ) : (
            <Message message="admin.settings.mfa.passkey_never_used" />
          )}
        </Suspense>
      </p>
    </div>
    <div className="flex flex-wrap items-start gap-2">
      <PasskeyRenameButton passkey={passkey} tenantId={tenantId} />
      <PasskeyRemoveButton passkeyId={passkey.id} tenantId={tenantId} />
    </div>
  </li>
);

const PasskeyAddStep = ({ tenantId }: { tenantId: string }) => (
  <PasskeyAddForm>
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ReportMfaSettingsChange />
    <PasskeyAdded />
    <div className="flex justify-end">
      <ActionFormSubmit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ActionFormIdle>
            <Message message="admin.settings.mfa.passkey_add_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.auth.mfa.passkey_waiting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </PasskeyAddForm>
);

/**
 * Asks for a name for the passkey just added. It replaces the add form, so
 * success is a toast rather than a message beside a form that is gone.
 */
const PasskeyNameStep = ({ tenantId }: { tenantId: string }) => (
  <ActionForm
    action={renameAccountPasskeyAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <AddedPasskeyIdInput />
    <SettledToast />
    <PasskeyNamed />
    <p className="text-sm font-medium text-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <Message message="admin.settings.mfa.passkey_name_title" />
      </Suspense>
    </p>
    <PasskeyNameField />
    <div className="flex justify-end gap-2">
      <SkipPasskeyNaming>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.settings.mfa.passkey_name_skip" />
        </Suspense>
      </SkipPasskeyNaming>
      <ActionFormSubmit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <ActionFormIdle>
            <Message message="admin.settings.mfa.passkey_name_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.settings.mfa.passkey_name_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);

/**
 * Regenerates the recovery codes with a passkey. The card shows the batch it
 * issues, as it does a code's regeneration's, so the answer is reported there.
 */
const PasskeyRegenerateStep = ({ tenantId }: { tenantId: string }) => (
  <PasskeyRegenerateForm>
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ReportMfaSettingsChange />
    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="admin.settings.mfa.regenerate_title" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.mfa.regenerate_passkey_description" />
        </Suspense>
      </p>
    </div>
    <div className="flex justify-end">
      <ActionFormSubmit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="admin.settings.mfa.regenerate_passkey_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.auth.mfa.passkey_waiting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </PasskeyRegenerateForm>
);

/**
 * The account's passkeys for the console, each with when it was added and
 * last used, and the form that adds another. `regeneratesRecoveryCodes` adds
 * the form that replaces the recovery codes with one of them, for an account
 * with no authenticator app to do it with a code.
 */
export const PasskeySettings = ({
  locale,
  passkeys,
  regeneratesRecoveryCodes,
  tenantId,
  timeZone,
}: {
  locale: Locale;
  passkeys: AdminPasskey[];
  regeneratesRecoveryCodes: boolean;
  tenantId: string;
  timeZone: string;
}) => (
  <div className="grid gap-3">
    <div className="grid gap-1">
      <h3 className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="admin.settings.mfa.passkeys_title" />
        </Suspense>
      </h3>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.mfa.passkeys_description" />
        </Suspense>
      </p>
    </div>
    {passkeys.length > 0 ? (
      <ul className="divide-y divide-border border-y border-border">
        {passkeys.map((passkey) => (
          <PasskeyRow
            dates={{ fallback: "-", locale, timeZone }}
            key={passkey.id}
            passkey={passkey}
            tenantId={tenantId}
          />
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="admin.settings.mfa.passkeys_empty" />
        </Suspense>
      </p>
    )}
    <PasskeyAddition
      add={<PasskeyAddStep tenantId={tenantId} />}
      name={<PasskeyNameStep tenantId={tenantId} />}
    />
    {regeneratesRecoveryCodes && passkeys.length > 0 ? (
      <PasskeyRegenerateStep tenantId={tenantId} />
    ) : null}
  </div>
);
