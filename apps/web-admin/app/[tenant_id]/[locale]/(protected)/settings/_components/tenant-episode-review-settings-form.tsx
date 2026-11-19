import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { updateTenantEpisodeReviewSettingsAction } from "../_lib/actions";

interface TenantEpisodeReviewSettingsFormProps {
  canEdit: boolean;
  /** The saved choice, absent when the read failed. */
  initialEpisodeReviewRequired?: boolean;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantEpisodeReviewSettingsForm = ({
  canEdit,
  initialEpisodeReviewRequired,
  loadErrorMessage,
  tenantId,
}: TenantEpisodeReviewSettingsFormProps) => {
  // Without the saved choice a save would turn review off over a tenant that
  // requires it, so editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);
  const required = initialEpisodeReviewRequired ?? false;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.episode_review.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.episode_review.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantEpisodeReviewSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          <Field.Root>
            <div className="flex items-center gap-2">
              {/* Keyed by the stored value, so a save that re-renders the screen
                  with a new one starts the box from it: Base UI's uncontrolled
                  default is read once. */}
              <Checkbox
                defaultChecked={required}
                key={String(required)}
                name="episode_review_required"
                value="on"
              />
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <Message message="admin.settings.episode_review.required_label" />
                </Suspense>
              </Field.Label>
            </div>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.episode_review.required_description" />
              </Suspense>
            </Field.Description>
          </Field.Root>
        </ActionForm.Fieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.settings.episode_review.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.episode_review.submit" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
