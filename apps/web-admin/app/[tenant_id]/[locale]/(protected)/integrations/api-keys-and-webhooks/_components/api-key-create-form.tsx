import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import { createApiKeyAction } from "../_lib/actions";
import { MAX_API_KEY_NAME_LENGTH } from "../_lib/form-schemas";
import * as IssuedSecret from "./issued-secret";

/**
 * Creates a key, and shows it whole under the form the one time the server
 * answers it.
 */
export const ApiKeyCreateForm = async ({
  disabled,
  tenantId,
}: {
  disabled: boolean;
  tenantId: string;
}) => {
  const t = await getMessages();

  return (
    <ActionForm.Root
      action={createApiKeyAction}
      className="grid gap-5 sm:max-w-3xl"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      <h3 className="text-base font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
          <Message message="admin.settings.api_keys.create_title" />
        </Suspense>
      </h3>

      <ActionForm.Fieldset className="grid gap-5" disabled={disabled}>
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.settings.api_keys.name" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="off"
              maxLength={MAX_API_KEY_NAME_LENGTH}
              name="name"
              required
              type="text"
            />
          </Field.Content>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="admin.settings.api_keys.name_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium text-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.settings.api_keys.scopes_legend" />
            </Suspense>
          </legend>
          <Field.Root>
            <div className="flex items-center gap-2">
              <Checkbox name="scopes" value="catalog" />
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.settings.api_keys.scopes.catalog_label" />
                </Suspense>
              </Field.Label>
            </div>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
                <Message message="admin.settings.api_keys.scopes.catalog_description" />
              </Suspense>
            </Field.Description>
          </Field.Root>
          <Field.Root>
            <div className="flex items-center gap-2">
              <Checkbox name="scopes" value="purchases" />
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.settings.api_keys.scopes.purchases_label" />
                </Suspense>
              </Field.Label>
            </div>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
                <Message message="admin.settings.api_keys.scopes.purchases_description" />
              </Suspense>
            </Field.Description>
          </Field.Root>
          <Field.Root>
            <div className="flex items-center gap-2">
              <Checkbox name="scopes" value="catalog_write" />
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.settings.api_keys.scopes.catalog_write_label" />
                </Suspense>
              </Field.Label>
            </div>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
                <Message message="admin.settings.api_keys.scopes.catalog_write_description" />
              </Suspense>
            </Field.Description>
          </Field.Root>
        </fieldset>
      </ActionForm.Fieldset>

      <div className="flex justify-end">
        <ActionForm.Submit disabled={disabled}>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <ActionForm.Idle>
              <Message message="admin.settings.api_keys.create" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.settings.api_keys.creating" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </div>

      <IssuedSecret.Root>
        <IssuedSecret.Title>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.settings.api_keys.issued_title" />
          </Suspense>
        </IssuedSecret.Title>
        <IssuedSecret.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.api_keys.issued_description" />
          </Suspense>
        </IssuedSecret.Description>
        <IssuedSecret.Value
          aria-label={t("admin.settings.api_keys.copy_key")}
        />
      </IssuedSecret.Root>
    </ActionForm.Root>
  );
};
