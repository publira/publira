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
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
} from "#components/action-form";
import { Message } from "#components/message";

import { setReaderBirthDateAction } from "../_lib/actions";

interface ChangeBirthDateButtonProps {
  /** The stored date as `YYYY-MM-DD`, or empty. */
  birthDate: string;
  /** The name the dialog calls the reader by. */
  name: string;
  publicId: string;
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
  tenantId,
}: ChangeBirthDateButtonProps) => {
  const formId = `birth-date-reader-${publicId}`;

  return (
    <ActionForm
      action={setReaderBirthDateAction}
      className="grid justify-items-start gap-1"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={<Button size="sm" type="button" variant="outline" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <ActionFormIdle>
              <Message message="admin.readers.birth_date_change" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.readers.birth_date_saving" />
            </ActionFormPending>
          </Suspense>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.readers.birth_date_confirm_title"
                  values={{ name }}
                />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.readers.birth_date_confirm_description" />
              </Suspense>
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <Field className="mt-4">
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.readers.birth_date" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              {/* The popup is portaled out of the form, so the input joins it by id. */}
              <Input
                defaultValue={birthDate}
                form={formId}
                name="birth_date"
                type="date"
              />
            </FieldContent>
          </Field>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialogCancel>
            <ConfirmDialogAction form={formId} variant="default">
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.readers.birth_date_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </ActionForm>
  );
};
