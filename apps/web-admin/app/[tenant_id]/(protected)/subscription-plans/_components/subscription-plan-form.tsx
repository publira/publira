import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import {
  SUBSCRIPTION_PLAN_DESCRIPTION_MAX_LENGTH,
  SUBSCRIPTION_PLAN_NAME_MAX_LENGTH,
} from "#lib/subscription-plan-shared";
import type {
  SubscriptionPlanItem,
  SubscriptionPlanTargetOption,
} from "#lib/subscription-plan-shared";

import * as SubscriptionPlanScope from "./subscription-plan-scope";

interface SubscriptionPlanFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  /** The plan being edited; absent, the form creates one. */
  initialPlan?: SubscriptionPlanItem;
  labels: SubscriptionPlanTargetOption[];
  /** Why the labels could not be read, beside the picker it empties. */
  labelsErrorMessage?: string;
  series: SubscriptionPlanTargetOption[];
  /** Why the series could not be read, beside the picker it empties. */
  seriesErrorMessage?: string;
  tenantId: string;
}

/**
 * The name, the description, the Stripe Price, what the plan opens, and
 * whether the site lists it. Every field is saved together, since
 * `UpdateSubscriptionPlan` replaces the whole plan.
 *
 * Awaits the catalog for the placeholders, which are attributes rather than
 * nodes. A create redirects from the Action to the new plan.
 */
export const SubscriptionPlanForm = async ({
  action,
  initialPlan,
  labels,
  labelsErrorMessage,
  series,
  seriesErrorMessage,
  tenantId,
}: SubscriptionPlanFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm.Root action={action} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />
      {initialPlan ? (
        <input
          name="subscription_plan_id"
          type="hidden"
          value={initialPlan.id}
        />
      ) : null}

      <ActionForm.Fieldset className="grid gap-5">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.subscription_plans.form.name" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={initialPlan?.name}
              maxLength={SUBSCRIPTION_PLAN_NAME_MAX_LENGTH}
              name="name"
              placeholder={t("admin.subscription_plans.form.name_placeholder")}
              required
              type="text"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.subscription_plans.form.name_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.subscription_plans.form.description" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Textarea
              defaultValue={initialPlan?.description}
              maxLength={SUBSCRIPTION_PLAN_DESCRIPTION_MAX_LENGTH}
              name="description"
              rows={4}
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.subscription_plans.form.description_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.subscription_plans.form.price" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="off"
              defaultValue={initialPlan?.stripePriceId}
              name="stripe_price_id"
              placeholder={t("admin.subscription_plans.form.price_placeholder")}
              required
              spellCheck={false}
              type="text"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.subscription_plans.form.price_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <SubscriptionPlanScope.Root
          initialLabelIds={initialPlan?.labelIds ?? []}
          initialScope={initialPlan?.scope ?? "all"}
          initialSeriesIds={initialPlan?.seriesIds ?? []}
        >
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.subscription_plans.form.scope" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SubscriptionPlanScope.RadioGroup
                items={[
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-64" />}
                      >
                        <Message message="admin.subscription_plans.scope.all_description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.subscription_plans.scope.all" />
                      </Suspense>
                    ),
                    value: "all",
                  },
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-64" />}
                      >
                        <Message message="admin.subscription_plans.scope.label_description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.subscription_plans.scope.label" />
                      </Suspense>
                    ),
                    value: "label",
                  },
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-64" />}
                      >
                        <Message message="admin.subscription_plans.scope.series_description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.subscription_plans.scope.series" />
                      </Suspense>
                    ),
                    value: "series",
                  },
                ]}
              />
            </Field.Content>
          </Field.Root>

          <SubscriptionPlanScope.When scope="label">
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.subscription_plans.form.labels" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                {labelsErrorMessage ? (
                  <FormMessage variant="destructive">
                    {labelsErrorMessage}
                  </FormMessage>
                ) : null}
                <SubscriptionPlanScope.LabelPicker labels={labels} />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.subscription_plans.form.labels_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          </SubscriptionPlanScope.When>

          <SubscriptionPlanScope.When scope="series">
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.subscription_plans.form.series" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                {seriesErrorMessage ? (
                  <FormMessage variant="destructive">
                    {seriesErrorMessage}
                  </FormMessage>
                ) : null}
                <SubscriptionPlanScope.SeriesPicker series={series} />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.subscription_plans.form.series_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          </SubscriptionPlanScope.When>
        </SubscriptionPlanScope.Root>

        <Field.Root>
          <div className="flex items-center gap-2">
            {/* Keyed by the stored value, so a save that re-renders the screen
                with a new one starts the box from it: Base UI's uncontrolled
                default is read once. */}
            <Checkbox
              defaultChecked={initialPlan?.published ?? false}
              key={String(initialPlan?.published ?? false)}
              name="published"
              value="on"
            />
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.subscription_plans.form.published" />
              </Suspense>
            </Field.Label>
          </div>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.subscription_plans.form.published_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              {initialPlan ? (
                <Message message="admin.subscription_plans.form.update" />
              ) : (
                <Message message="admin.subscription_plans.form.create" />
              )}
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.subscription_plans.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
