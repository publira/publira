import { LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { getOperatorRoleSelectItems } from "#lib/operator-labels";

import { createOperatorAction } from "../_lib/actions";

export const CreateOperatorForm = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <ActionForm
      action={createOperatorAction}
      className="grid gap-4 sm:max-w-2xl"
    >
      <Field>
        <FieldLabel htmlFor="operator_name" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.common.name" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input id="operator_name" name="operator_name" required type="text" />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="operator_email" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="platform.common.email" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            id="operator_email"
            name="operator_email"
            placeholder="operator@example.com"
            required
            type="email"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="operator_role" required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.common.role" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Suspense fallback={<Skeleton className="h-10 w-full" />}>
            <Select
              id="operator_role"
              items={getOperatorRoleSelectItems(messages)}
              name="operator_role"
              placeholder={getMessage(
                messages,
                "platform.common.select_placeholder"
              )}
              required
            />
          </Suspense>
        </FieldContent>
      </Field>

      <div className="mt-2 flex gap-3">
        <ActionFormSubmit>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.common.add" />
          </Suspense>
        </ActionFormSubmit>
        <LinkButton render={<Link href="/operators" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.operators.cancel" />
          </Suspense>
        </LinkButton>
      </div>
    </ActionForm>
  );
};
