"use server";

import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  checkboxOnFormSchema,
  optionalTrimmedString,
  recordIdListFormSchema,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import {
  createSubscriptionPlan,
  deleteSubscriptionPlan,
  subscriptionPlansCacheTag,
  updateSubscriptionPlan,
} from "#lib/subscription-plan";
import type { SubscriptionPlanFields } from "#lib/subscription-plan";
import {
  SUBSCRIPTION_PLAN_DESCRIPTION_MAX_LENGTH,
  SUBSCRIPTION_PLAN_MAX_TARGETS,
  SUBSCRIPTION_PLAN_NAME_MAX_LENGTH,
  SUBSCRIPTION_PLAN_SCOPES,
} from "#lib/subscription-plan-shared";

const tenantIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(
    t("admin.subscription_plans.validation.tenant_missing")
  );
};

const idSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredRecordId(t("admin.subscription_plans.validation.id_missing"));
};

/** The fields a create and an update both post, held to the API's rules. */
const planFieldsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  const targets = recordIdListFormSchema.pipe(
    z
      .array(z.string())
      .max(
        SUBSCRIPTION_PLAN_MAX_TARGETS,
        t("admin.subscription_plans.validation.targets_too_many")
      )
  );

  return z.object({
    description: optionalTrimmedString(
      SUBSCRIPTION_PLAN_DESCRIPTION_MAX_LENGTH,
      t("admin.subscription_plans.validation.description_too_long")
    ),
    labelIds: targets,
    name: requiredTrimmedString(
      t("admin.subscription_plans.validation.name_required"),
      SUBSCRIPTION_PLAN_NAME_MAX_LENGTH,
      t("admin.subscription_plans.validation.name_too_long")
    ),
    published: checkboxOnFormSchema,
    scope: z.enum(SUBSCRIPTION_PLAN_SCOPES, {
      error: t("admin.subscription_plans.validation.scope_required"),
    }),
    seriesIds: targets,
    stripePriceId: requiredTrimmedString(
      t("admin.subscription_plans.validation.price_required")
    ),
    tenantId: await tenantIdSchema(locale),
  });
};

/**
 * A plan of labels names at least one label, and a plan of series at least
 * one series. The form posts both lists whichever scope is chosen, so only
 * the one the scope names is checked here, and only that one is sent.
 */
const requireScopeTargets =
  (t: AdminMessageAccessor) =>
  (
    fields: Pick<SubscriptionPlanFields, "labelIds" | "scope" | "seriesIds">,
    context: z.RefinementCtx
  ): void => {
    if (fields.scope === "label" && fields.labelIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: t("admin.subscription_plans.validation.labels_required"),
        path: ["labelIds"],
      });
    }

    if (fields.scope === "series" && fields.seriesIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: t("admin.subscription_plans.validation.series_required"),
        path: ["seriesIds"],
      });
    }
  };

const planFormFields = {
  description: "value",
  labelIds: { kind: "values", name: "label_ids" },
  name: "value",
  published: "value",
  scope: "value",
  seriesIds: { kind: "values", name: "series_ids" },
  stripePriceId: { kind: "value", name: "stripe_price_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/** Creates the plan the new screen submitted and opens it. */
export const createSubscriptionPlanAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    planFieldsSchema(locale),
  ]);

  const parsed = schema
    .superRefine(requireScopeTargets(t))
    .safeParse(toFormDataInput(formData, planFormFields));

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    createSubscriptionPlan(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(subscriptionPlansCacheTag(parsed.data.tenantId));

  // The plan exists, so staying on this form would only invite a second one.
  redirect(`/subscription-plans/${result.plan.publicId}?created=1`);
};

/** Saves the plan the edit screen submitted, every field together. */
export const updateSubscriptionPlanAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema, id] = await Promise.all([
    getMessagesFor(locale),
    planFieldsSchema(locale),
    idSchema(locale),
  ]);

  const parsed = schema
    .extend({ id })
    .superRefine(requireScopeTargets(t))
    .safeParse(
      toFormDataInput(formData, {
        ...planFormFields,
        id: { kind: "value", name: "subscription_plan_id" },
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    updateSubscriptionPlan(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(subscriptionPlansCacheTag(parsed.data.tenantId));

  return { message: t("admin.subscription_plans.updated"), ok: true };
};

export const deleteSubscriptionPlanAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, id, tenantId] = await Promise.all([
    getMessagesFor(locale),
    idSchema(locale),
    tenantIdSchema(locale),
  ]);

  const parsed = z.object({ id, tenantId }).safeParse(
    toFormDataInput(formData, {
      id: { kind: "value", name: "subscription_plan_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deleteSubscriptionPlan(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(subscriptionPlansCacheTag(parsed.data.tenantId));

  return { message: t("admin.subscription_plans.deleted"), ok: true };
};
