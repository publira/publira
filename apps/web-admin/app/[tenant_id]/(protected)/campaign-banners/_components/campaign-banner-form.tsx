import type { FormActionState } from "@publira/ui-components/action-form";
import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { CAMPAIGN_BANNER_LINK_MAX_LENGTH } from "#lib/campaign-banner-schedule";
import { getMessages } from "#lib/get-messages";

import type { CampaignBannerListItem } from "../campaign-banner-types";

interface CampaignBannerFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  /** The banner being edited; absent, the form creates one. */
  initialBanner?: CampaignBannerListItem;
  tenantId: string;
  /** The tenant's display zone, which the window is entered in. */
  timeZone: string;
}

/**
 * The link, the window, and the published flag, and — when it creates a
 * banner — the image. A new banner needs both an image and a link, so the
 * form asks for each before it submits; an existing one keeps its image, which
 * the cover image tab replaces.
 *
 * Awaits the catalog for the link's placeholder, which is an attribute rather
 * than a node. A create redirects from the Action to the new banner.
 */
export const CampaignBannerForm = async ({
  action,
  initialBanner,
  tenantId,
  timeZone,
}: CampaignBannerFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm action={action} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />
      {initialBanner ? (
        <input
          name="campaign_banner_id"
          type="hidden"
          value={initialBanner.id}
        />
      ) : null}

      <ActionFormFieldset className="grid gap-5">
        {initialBanner ? null : (
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.campaign_banners.form.image" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="eye_catch_image"
                required
                type="file"
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.campaign_banners.form.image_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>
        )}

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.campaign_banners.form.link" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={initialBanner?.linkUrl}
              maxLength={CAMPAIGN_BANNER_LINK_MAX_LENGTH}
              name="link_url"
              placeholder={t("admin.campaign_banners.form.link_placeholder")}
              required
              type="text"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.campaign_banners.form.link_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.campaign_banners.form.starts_at" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <InstantInput
                initialValue={initialBanner?.startsAt}
                name="starts_at"
                required
                step={60}
                timeZone={timeZone}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.campaign_banners.form.ends_at" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <InstantInput
                initialValue={initialBanner?.endsAt}
                name="ends_at"
                required
                step={60}
                timeZone={timeZone}
              />
            </FieldContent>
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message
              message="admin.campaign_banners.form.window_description"
              values={{ time_zone: timeZone }}
            />
          </Suspense>
        </p>

        <Field>
          <div className="flex items-center gap-2">
            {/* Keyed by the stored value, so a save that re-renders the screen
                with a new one starts the box from it: Base UI's uncontrolled
                default is read once. */}
            <Checkbox
              defaultChecked={initialBanner?.published ?? false}
              key={String(initialBanner?.published ?? false)}
              name="published"
              value="on"
            />
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.campaign_banners.form.published" />
              </Suspense>
            </FieldLabel>
          </div>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.campaign_banners.form.published_description" />
            </Suspense>
          </FieldDescription>
        </Field>
      </ActionFormFieldset>

      <div className="flex justify-end">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              {initialBanner ? (
                <Message message="admin.campaign_banners.form.update" />
              ) : (
                <Message message="admin.campaign_banners.form.create" />
              )}
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.campaign_banners.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};
