import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import {
  CAMPAIGN_BANNER_ALT_TEXT_MAX_LENGTH,
  CAMPAIGN_BANNER_LINK_MAX_LENGTH,
} from "#lib/campaign-banner-schedule";
import { getMessages } from "#lib/get-messages";

import type { CampaignBannerListItem } from "../campaign-banner-types";

interface CampaignBannerFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  /** The banner being edited; absent, the form creates one. */
  initialBanner?: CampaignBannerListItem;
  tenantId: string;
  /** The tenant's display zone, which the window is entered in. */
  timeZone: string;
}

/**
 * The alternative text, the link, the window, and the published flag, and —
 * when it creates a banner — the image. A new banner needs both an image and a
 * link, so the form asks for each before it submits; an existing one keeps its
 * image, which the cover image tab replaces.
 *
 * Awaits the catalog for the placeholders, which are attributes rather than
 * nodes. A create redirects from the Action to the new banner.
 */
export const CampaignBannerForm = async ({
  action,
  initialBanner,
  tenantId,
  timeZone,
}: CampaignBannerFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm.Root action={action} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />
      {initialBanner ? (
        <input
          name="campaign_banner_id"
          type="hidden"
          value={initialBanner.id}
        />
      ) : null}

      <ActionForm.Fieldset className="grid gap-5">
        {initialBanner ? null : (
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.campaign_banners.form.image" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="eye_catch_image"
                required
                type="file"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.campaign_banners.form.image_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>
        )}

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.campaign_banners.form.alt_text" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={initialBanner?.altText}
              maxLength={CAMPAIGN_BANNER_ALT_TEXT_MAX_LENGTH}
              name="alt_text"
              placeholder={t(
                "admin.campaign_banners.form.alt_text_placeholder"
              )}
              type="text"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.campaign_banners.form.alt_text_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.campaign_banners.form.link" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={initialBanner?.linkUrl}
              maxLength={CAMPAIGN_BANNER_LINK_MAX_LENGTH}
              name="link_url"
              placeholder={t("admin.campaign_banners.form.link_placeholder")}
              required
              type="text"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.campaign_banners.form.link_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.campaign_banners.form.starts_at" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <InstantInput
                initialValue={initialBanner?.startsAt}
                name="starts_at"
                required
                step={60}
                timeZone={timeZone}
              />
            </Field.Content>
          </Field.Root>
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.campaign_banners.form.ends_at" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <InstantInput
                initialValue={initialBanner?.endsAt}
                name="ends_at"
                required
                step={60}
                timeZone={timeZone}
              />
            </Field.Content>
          </Field.Root>
        </div>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message
              message="admin.campaign_banners.form.window_description"
              values={{ time_zone: timeZone }}
            />
          </Suspense>
        </p>

        <Field.Root>
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
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.campaign_banners.form.published" />
              </Suspense>
            </Field.Label>
          </div>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.campaign_banners.form.published_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              {initialBanner ? (
                <Message message="admin.campaign_banners.form.update" />
              ) : (
                <Message message="admin.campaign_banners.form.create" />
              )}
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.campaign_banners.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
