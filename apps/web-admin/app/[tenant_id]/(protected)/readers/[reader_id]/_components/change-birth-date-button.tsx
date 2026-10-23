import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { setReaderBirthDateAction } from "../_lib/actions";

interface ChangeBirthDateButtonProps {
  /** The stored date as `YYYY-MM-DD`, or empty. */
  birthDate: string;
  /** The name the dialog calls the reader by. */
  name: string;
  publicId: string;
  readerId: string;
  tenantId: string;
}

/**
 * Sets or clears the reader's birth date from a dialog that says what the
 * change does to their access before staff confirm it.
 */
export const ChangeBirthDateButton = ({
  birthDate,
  name,
  publicId,
  readerId,
  tenantId,
}: ChangeBirthDateButtonProps) => {
  const formId = `birth-date-reader-${publicId}`;

  return (
    <ActionForm.Root
      action={setReaderBirthDateAction}
      className="grid justify-items-start gap-1"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <input name="reader_id" type="hidden" value={readerId} />
      <ActionForm.Fieldset>
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <ActionForm.Idle>
                <Message message="admin.readers.birth_date_change" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.readers.birth_date_saving" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message
                    message="admin.readers.birth_date_confirm_title"
                    values={{ name }}
                  />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.readers.birth_date_confirm_description" />
                </Suspense>
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            <Field.Root className="mt-4">
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.readers.birth_date" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                {/* The popup is portaled out of the form, so the input joins it by id. */}
                <Input
                  defaultValue={birthDate}
                  form={formId}
                  name="birth_date"
                  type="date"
                />
              </Field.Content>
            </Field.Root>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action form={formId} variant="default">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.readers.birth_date_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
