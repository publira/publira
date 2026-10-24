import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
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
import * as MfaSettingsOutcome from "./mfa-settings-outcome";
import * as PasskeyAddition from "./passkey-addition";
import { PasskeyRegenerateForm } from "./passkey-regeneration";

const PasskeyNameField = ({
  defaultValue,
  form,
}: {
  defaultValue?: string;
  /** The form the field joins from a dialog's portal. */
  form?: string;
}) => (
  <Field.Root>
    <Field.Label>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.settings.mfa.passkey_name_label" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <Input
        autoComplete="off"
        defaultValue={defaultValue}
        form={form}
        name="name"
      />
    </Field.Content>
    <Field.Description>
      <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
        <Message message="admin.settings.mfa.passkey_name_description" />
      </Suspense>
    </Field.Description>
  </Field.Root>
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
    <ActionForm.Root
      action={renameAccountPasskeyAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="passkey_id" type="hidden" value={passkey.id} />
      <SettledToast />
      <ActionForm.Fieldset className="grid">
        <Dialog.Root>
          <Dialog.Trigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.mfa.passkey_rename" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.mfa.passkey_name_submitting" />
              </ActionForm.Pending>
            </Suspense>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Viewport>
              <Dialog.Popup>
                <Dialog.Header>
                  <Dialog.Title className="text-lg font-semibold">
                    <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                      <Message message="admin.settings.mfa.passkey_name_title" />
                    </Suspense>
                  </Dialog.Title>
                </Dialog.Header>
                <div className="mt-4">
                  <PasskeyNameField defaultValue={passkey.name} form={formId} />
                </div>
                <Dialog.Footer>
                  <Dialog.Close
                    render={<Button type="button" variant="outline" />}
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.common.cancel" />
                    </Suspense>
                  </Dialog.Close>
                  <Dialog.Close form={formId} render={<Button />} type="submit">
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.settings.mfa.passkey_name_submit" />
                    </Suspense>
                  </Dialog.Close>
                </Dialog.Footer>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
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
    <ActionForm.Root
      action={deleteAccountPasskeyAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="passkey_id" type="hidden" value={passkeyId} />
      <MfaSettingsOutcome.Report />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.mfa.passkey_remove" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.mfa.passkey_removing" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.settings.mfa.passkey_remove_confirm_title" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.mfa.passkey_remove_confirm_description" />
                </Suspense>
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.mfa.passkey_remove_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
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
  <PasskeyAddition.AddForm>
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaSettingsOutcome.Report />
    <PasskeyAddition.Added />
    <div className="flex justify-end">
      <ActionForm.Submit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ActionForm.Idle>
            <Message message="admin.settings.mfa.passkey_add_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.auth.mfa.passkey_waiting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </PasskeyAddition.AddForm>
);

/**
 * Asks for a name for the passkey just added. It replaces the add form, so
 * success is a toast rather than a message beside a form that is gone.
 */
const PasskeyNameStep = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root
    action={renameAccountPasskeyAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <PasskeyAddition.AddedIdInput />
    <SettledToast />
    <PasskeyAddition.Named />
    <p className="text-sm font-medium text-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <Message message="admin.settings.mfa.passkey_name_title" />
      </Suspense>
    </p>
    <PasskeyNameField />
    <div className="flex justify-end gap-2">
      <PasskeyAddition.SkipNaming>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.settings.mfa.passkey_name_skip" />
        </Suspense>
      </PasskeyAddition.SkipNaming>
      <ActionForm.Submit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <ActionForm.Idle>
            <Message message="admin.settings.mfa.passkey_name_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.settings.mfa.passkey_name_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

/**
 * Regenerates the recovery codes with a passkey. The card shows the batch it
 * issues, as it does a code's regeneration's, so the answer is reported there.
 */
const PasskeyRegenerateStep = ({ tenantId }: { tenantId: string }) => (
  <PasskeyRegenerateForm>
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaSettingsOutcome.Report />
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
      <ActionForm.Submit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="admin.settings.mfa.regenerate_passkey_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.auth.mfa.passkey_waiting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
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
    <PasskeyAddition.Root
      add={<PasskeyAddStep tenantId={tenantId} />}
      name={<PasskeyNameStep tenantId={tenantId} />}
    />
    {regeneratesRecoveryCodes && passkeys.length > 0 ? (
      <PasskeyRegenerateStep tenantId={tenantId} />
    ) : null}
  </div>
);
