import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { MAX_INT32 } from "#lib/int32";
import type { PromotionCodeItem } from "#lib/promotion-code-shared";

interface PromotionCodeLimitsFieldsProps {
  /** The code being edited; absent, the fields start blank for a new one. */
  initialCode?: Pick<
    PromotionCodeItem,
    "endsAt" | "maxRedemptions" | "maxRedemptionsPerReader" | "startsAt"
  >;
  timeZone: string;
}

/**
 * When the code works and how often it may be redeemed: the part of a code
 * that can change once it is created, so the create form and the edit form
 * share it. Every field may be left blank, for no bound and no limit.
 */
export const PromotionCodeLimitsFields = ({
  initialCode,
  timeZone,
}: PromotionCodeLimitsFieldsProps) => (
  <>
    <div className="grid gap-5 sm:grid-cols-2">
      <Field.Root>
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.promotion_codes.form.starts_at" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <InstantInput
            initialValue={initialCode?.startsAt}
            name="starts_at"
            step={60}
            timeZone={timeZone}
          />
          <ActionForm.FieldError name="starts_at" />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.promotion_codes.form.starts_at_description" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
      <Field.Root>
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.promotion_codes.form.ends_at" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <InstantInput
            initialValue={initialCode?.endsAt}
            name="ends_at"
            step={60}
            timeZone={timeZone}
          />
          <ActionForm.FieldError name="ends_at" />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message
                message="admin.promotion_codes.form.ends_at_description"
                values={{ time_zone: timeZone }}
              />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
    </div>

    <div className="grid gap-5 sm:grid-cols-2">
      <Field.Root>
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.promotion_codes.form.max_redemptions" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input
            className="sm:max-w-48"
            defaultValue={initialCode?.maxRedemptions || ""}
            max={MAX_INT32}
            min={1}
            name="max_redemptions"
            step={1}
            type="number"
          />
          <ActionForm.FieldError name="max_redemptions" />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.promotion_codes.form.max_redemptions_description" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
      <Field.Root>
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.promotion_codes.form.max_redemptions_per_reader" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input
            className="sm:max-w-48"
            defaultValue={initialCode?.maxRedemptionsPerReader || ""}
            max={MAX_INT32}
            min={1}
            name="max_redemptions_per_reader"
            step={1}
            type="number"
          />
          <ActionForm.FieldError name="max_redemptions_per_reader" />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.promotion_codes.form.max_redemptions_per_reader_description" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
    </div>
  </>
);
