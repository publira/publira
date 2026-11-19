import * as ActionForm from "@publira/ui-components/action-form";
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import { maxPriceInputValue, priceInputStep } from "#lib/price";
import {
  PROMOTION_CODE_MAX_LENGTH,
  PROMOTION_CODE_PATTERN,
} from "#lib/promotion-code-shared";
import type { PromotionCodeTargetOption } from "#lib/promotion-code-shared";

import * as PromotionCodeDiscount from "./promotion-code-discount";
import { PromotionCodeLimitsFields } from "./promotion-code-limits-fields";
import * as PromotionCodeTarget from "./promotion-code-target";

interface PromotionCodeFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  /** ISO 4217 code of the currency an amount off is entered in, the tenant's. */
  currency: string;
  labels: PromotionCodeTargetOption[];
  /** Why the labels could not be read, beside the picker it empties. */
  labelsErrorMessage?: string;
  series: PromotionCodeTargetOption[];
  /** Why the series could not be read, beside the picker it empties. */
  seriesErrorMessage?: string;
  tenantId: string;
  timeZone: string;
}

/**
 * The code, its discount, what it applies to, when it works, and how often it
 * may be redeemed. The first three are fixed once the code is created, which
 * the form says before it is submitted.
 *
 * Awaits the catalog for the placeholders and the kinds' wording, which are
 * attributes and radio items rather than nodes. A create redirects from the
 * Action to the new code.
 */
export const PromotionCodeForm = async ({
  action,
  currency,
  labels,
  labelsErrorMessage,
  series,
  seriesErrorMessage,
  tenantId,
  timeZone,
}: PromotionCodeFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm.Root action={action} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="discount_currency" type="hidden" value={currency} />

      <ActionForm.Fieldset className="grid gap-5">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.promotion_codes.form.code" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoCapitalize="characters"
              autoComplete="off"
              className="sm:max-w-72"
              maxLength={PROMOTION_CODE_MAX_LENGTH}
              name="code"
              pattern={PROMOTION_CODE_PATTERN}
              placeholder={t("admin.promotion_codes.form.code_placeholder")}
              required
              spellCheck={false}
              type="text"
            />
            <ActionForm.FieldError name="code" />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.promotion_codes.form.code_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <PromotionCodeDiscount.Root>
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.promotion_codes.form.discount" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <PromotionCodeDiscount.RadioGroup
                items={[
                  {
                    label: t("admin.promotion_codes.form.discount_percent"),
                    value: "percent",
                  },
                  {
                    label: t("admin.promotion_codes.form.discount_amount"),
                    value: "amount",
                  },
                ]}
              />
            </Field.Content>
          </Field.Root>

          <PromotionCodeDiscount.When kind="percent">
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.promotion_codes.form.percent" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  className="sm:max-w-48"
                  max={100}
                  min={1}
                  name="discount_value"
                  required
                  step={1}
                  type="number"
                />
                <ActionForm.FieldError name="discount_value" />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.promotion_codes.form.percent_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          </PromotionCodeDiscount.When>

          <PromotionCodeDiscount.When kind="amount">
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.promotion_codes.form.amount" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  className="sm:max-w-48"
                  max={maxPriceInputValue(currency)}
                  min={priceInputStep(currency)}
                  name="discount_value"
                  required
                  step={priceInputStep(currency)}
                  type="number"
                />
                <ActionForm.FieldError name="discount_value" />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.promotion_codes.form.amount_description"
                      values={{ currency }}
                    />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          </PromotionCodeDiscount.When>
        </PromotionCodeDiscount.Root>

        <PromotionCodeTarget.Root tenantId={tenantId}>
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.promotion_codes.form.target" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <PromotionCodeTarget.RadioGroup
                items={[
                  {
                    label: t("admin.promotion_codes.target_kinds.catalog"),
                    value: "catalog",
                  },
                  {
                    label: t("admin.promotion_codes.target_kinds.label"),
                    value: "label",
                  },
                  {
                    label: t("admin.promotion_codes.target_kinds.series"),
                    value: "series",
                  },
                  {
                    label: t("admin.promotion_codes.target_kinds.volume"),
                    value: "volume",
                  },
                  {
                    label: t("admin.promotion_codes.target_kinds.episode"),
                    value: "episode",
                  },
                ]}
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.promotion_codes.form.target_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <PromotionCodeTarget.When kinds={["label"]}>
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.promotion_codes.form.target_label" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                {labelsErrorMessage ? (
                  <FormMessage variant="destructive">
                    {labelsErrorMessage}
                  </FormMessage>
                ) : null}
                <PromotionCodeTarget.LabelCombobox labels={labels}>
                  <Combobox.Input
                    placeholder={t(
                      "admin.promotion_codes.form.target_label_placeholder"
                    )}
                  />
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.promotion_codes.form.target_no_match" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </PromotionCodeTarget.LabelCombobox>
                <ActionForm.FieldError name="target_id" />
              </Field.Content>
            </Field.Root>
          </PromotionCodeTarget.When>

          <PromotionCodeTarget.When kinds={["series", "volume", "episode"]}>
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.promotion_codes.form.target_series" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                {seriesErrorMessage ? (
                  <FormMessage variant="destructive">
                    {seriesErrorMessage}
                  </FormMessage>
                ) : null}
                <PromotionCodeTarget.SeriesCombobox series={series}>
                  <Combobox.Input
                    placeholder={t(
                      "admin.promotion_codes.form.target_series_placeholder"
                    )}
                  />
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.promotion_codes.form.target_no_match" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </PromotionCodeTarget.SeriesCombobox>
                <PromotionCodeTarget.When kinds={["series"]}>
                  <ActionForm.FieldError name="target_id" />
                </PromotionCodeTarget.When>
              </Field.Content>
            </Field.Root>
          </PromotionCodeTarget.When>

          <PromotionCodeTarget.When kinds={["volume"]}>
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.promotion_codes.form.target_volume" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <PromotionCodeTarget.ChildCombobox>
                  <PromotionCodeTarget.ChildInput />
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.promotion_codes.form.target_no_volumes" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </PromotionCodeTarget.ChildCombobox>
                <PromotionCodeTarget.ChildLoadError>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.common.retry" />
                  </Suspense>
                </PromotionCodeTarget.ChildLoadError>
                <ActionForm.FieldError name="target_id" />
                <PromotionCodeTarget.SeriesWhile chosen={false}>
                  <Field.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.promotion_codes.form.target_needs_series" />
                    </Suspense>
                  </Field.Description>
                </PromotionCodeTarget.SeriesWhile>
              </Field.Content>
            </Field.Root>
          </PromotionCodeTarget.When>

          <PromotionCodeTarget.When kinds={["episode"]}>
            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.promotion_codes.form.target_episode" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <PromotionCodeTarget.ChildCombobox>
                  <PromotionCodeTarget.ChildInput />
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.promotion_codes.form.target_no_episodes" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </PromotionCodeTarget.ChildCombobox>
                <PromotionCodeTarget.ChildLoadError>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.common.retry" />
                  </Suspense>
                </PromotionCodeTarget.ChildLoadError>
                <ActionForm.FieldError name="target_id" />
                <PromotionCodeTarget.SeriesWhile chosen={false}>
                  <Field.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.promotion_codes.form.target_needs_series" />
                    </Suspense>
                  </Field.Description>
                </PromotionCodeTarget.SeriesWhile>
              </Field.Content>
            </Field.Root>
          </PromotionCodeTarget.When>
        </PromotionCodeTarget.Root>

        <PromotionCodeLimitsFields timeZone={timeZone} />
      </ActionForm.Fieldset>

      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.promotion_codes.form.fixed_note" />
        </Suspense>
      </p>

      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.promotion_codes.form.submit" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.promotion_codes.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
