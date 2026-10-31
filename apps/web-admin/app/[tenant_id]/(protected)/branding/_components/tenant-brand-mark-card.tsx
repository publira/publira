import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Card from "@publira/ui-components/card";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import Image from "next/image";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { BrandMarkKind, TenantBrandMark } from "#lib/brand-marks";
import { getMessages } from "#lib/get-messages";
import { tenantBrandingVariant } from "#lib/tenant-branding-image";

import { updateTenantBrandMarkAction } from "../_lib/actions";
import { BRAND_MARK_GUIDELINE_URLS } from "../_lib/brand-mark-guidelines";
import * as BrandMarkConsent from "./brand-mark-consent";

/** The mark's name, each branch spelling out its own key. */
const BrandMarkTitle = ({ kind }: { kind: BrandMarkKind }) => {
  switch (kind) {
    case "x_share": {
      return (
        <Message message="admin.settings.brand_marks.kinds.x_share.title" />
      );
    }

    case "line_share": {
      return (
        <Message message="admin.settings.brand_marks.kinds.line_share.title" />
      );
    }

    case "app_store_badge": {
      return (
        <Message message="admin.settings.brand_marks.kinds.app_store_badge.title" />
      );
    }

    case "google_play_badge": {
      return (
        <Message message="admin.settings.brand_marks.kinds.google_play_badge.title" />
      );
    }

    case "apple_sign_in": {
      return (
        <Message message="admin.settings.brand_marks.kinds.apple_sign_in.title" />
      );
    }

    case "google_sign_in": {
      return (
        <Message message="admin.settings.brand_marks.kinds.google_sign_in.title" />
      );
    }

    default: {
      return null;
    }
  }
};

/** The name of the owner's guideline page, each branch spelling out its own key. */
const BrandMarkGuideline = ({ kind }: { kind: BrandMarkKind }) => {
  switch (kind) {
    case "x_share": {
      return (
        <Message message="admin.settings.brand_marks.kinds.x_share.guideline" />
      );
    }

    case "line_share": {
      return (
        <Message message="admin.settings.brand_marks.kinds.line_share.guideline" />
      );
    }

    case "app_store_badge": {
      return (
        <Message message="admin.settings.brand_marks.kinds.app_store_badge.guideline" />
      );
    }

    case "google_play_badge": {
      return (
        <Message message="admin.settings.brand_marks.kinds.google_play_badge.guideline" />
      );
    }

    case "apple_sign_in": {
      return (
        <Message message="admin.settings.brand_marks.kinds.apple_sign_in.guideline" />
      );
    }

    case "google_sign_in": {
      return (
        <Message message="admin.settings.brand_marks.kinds.google_sign_in.guideline" />
      );
    }

    default: {
      return null;
    }
  }
};

interface TenantBrandMarkCardProps {
  kind: BrandMarkKind;
  locale: Locale;
  mark: TenantBrandMark | null;
  tenantId: string;
  timeZone: string;
}

/**
 * One mark: what is uploaded and under which guidelines, or that nothing is.
 * Uploading — the first time or as a replacement — goes through a dialog that
 * shows the owner's guidelines and keeps the file field closed until they are
 * accepted; deleting asks first. Both post to one Action, told apart by
 * `intent`, and a save redraws the card from the stored mark.
 */
export const TenantBrandMarkCard = async ({
  kind,
  locale,
  mark,
  tenantId,
  timeZone,
}: TenantBrandMarkCardProps) => {
  const t = await getMessages();
  const formId = `tenant-brand-mark-${kind}`;
  const preview = mark ? tenantBrandingVariant(mark.image) : null;
  const guidelineUrl = BRAND_MARK_GUIDELINE_URLS[kind];

  const acceptedAt = mark?.termsAcceptedAt
    ? formatDateTime(mark.termsAcceptedAt, { locale, timeZone })
    : "";

  return (
    <Card.Root>
      <Card.Header>
        <h3 className="font-sans text-base leading-tight font-medium">
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <BrandMarkTitle kind={kind} />
          </Suspense>
        </h3>
      </Card.Header>
      <Card.Content>
        <ActionForm.Root
          action={updateTenantBrandMarkAction}
          className="grid gap-4"
          id={formId}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="kind" type="hidden" value={kind} />

          {mark && preview ? (
            <div className="grid gap-2">
              <Image
                alt={t("admin.settings.brand_marks.current")}
                className="h-12 w-auto max-w-full justify-self-start rounded-control border bg-card object-contain"
                height={preview.height}
                src={preview.url}
                width={preview.width}
              />
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                  {mark.termsAcceptedByName ? (
                    <Message
                      message="admin.settings.brand_marks.accepted_by"
                      values={{
                        accepted_at: acceptedAt,
                        name: mark.termsAcceptedByName,
                      }}
                    />
                  ) : (
                    <Message
                      message="admin.settings.brand_marks.accepted_by_deleted_account"
                      values={{ accepted_at: acceptedAt }}
                    />
                  )}
                </Suspense>
              </p>
              {mark.termsUrl ? (
                <a
                  className="justify-self-start text-sm text-primary underline underline-offset-4"
                  href={mark.termsUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.brand_marks.accepted_terms" />
                  </Suspense>
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.brand_marks.unset" />
              </Suspense>
            </p>
          )}

          <ActionForm.Fieldset className="flex flex-wrap gap-2">
            {/* The form wraps the dialog rather than sitting in its popup, and
                the popup's fields join it through `form=`, so the upload
                submits a form that is still mounted while the popup closes. */}
            <Dialog.Root>
              <Dialog.Trigger
                render={
                  <Button
                    size="sm"
                    type="button"
                    variant={mark ? "outline" : "default"}
                  />
                }
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <ActionForm.Idle>
                    {mark ? (
                      <Message message="admin.settings.brand_marks.replace" />
                    ) : (
                      <Message message="admin.settings.brand_marks.upload" />
                    )}
                  </ActionForm.Idle>
                  <ActionForm.Pending>
                    <Message message="admin.settings.saving" />
                  </ActionForm.Pending>
                </Suspense>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Backdrop />
                <Dialog.Viewport>
                  <Dialog.Popup>
                    <BrandMarkConsent.Root>
                      <Dialog.Header>
                        <Dialog.Title className="text-lg font-semibold">
                          <Suspense
                            fallback={<SkeletonLine className="h-5 w-48" />}
                          >
                            <Message message="admin.settings.brand_marks.consent_title" />
                          </Suspense>
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-muted-foreground">
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-72" />}
                          >
                            <Message message="admin.settings.brand_marks.consent_description" />
                          </Suspense>
                        </Dialog.Description>
                      </Dialog.Header>

                      <div className="mt-4 grid gap-4">
                        <a
                          className="justify-self-start text-sm text-primary underline underline-offset-4"
                          href={guidelineUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-48" />}
                          >
                            <BrandMarkGuideline kind={kind} />
                          </Suspense>
                        </a>
                        {/* The page this dialog linked to is what the upload
                            records as accepted. */}
                        <input
                          form={formId}
                          name="terms_url"
                          type="hidden"
                          value={guidelineUrl}
                        />

                        <BrandMarkConsent.Accept form={formId}>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-64" />}
                          >
                            <Message message="admin.settings.brand_marks.consent_accept" />
                          </Suspense>
                        </BrandMarkConsent.Accept>

                        <BrandMarkConsent.Field>
                          <Field.Label>
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-24" />}
                            >
                              <Message message="admin.settings.brand_marks.file" />
                            </Suspense>
                          </Field.Label>
                          <Field.Content>
                            <Input
                              accept="image/jpeg,image/png,image/webp"
                              form={formId}
                              name="image"
                              type="file"
                            />
                            <Field.Description>
                              <Suspense
                                fallback={
                                  <SkeletonLine className="h-4 w-3/4" />
                                }
                              >
                                <Message message="admin.settings.brand_marks.file_description" />
                              </Suspense>
                            </Field.Description>
                          </Field.Content>
                        </BrandMarkConsent.Field>
                      </div>

                      <Dialog.Footer>
                        <Dialog.Close
                          render={<Button type="button" variant="outline" />}
                        >
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-12" />}
                          >
                            <Message message="admin.common.cancel" />
                          </Suspense>
                        </Dialog.Close>
                        <BrandMarkConsent.Submit form={formId}>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-24" />}
                          >
                            <Message message="admin.settings.brand_marks.submit" />
                          </Suspense>
                        </BrandMarkConsent.Submit>
                      </Dialog.Footer>
                    </BrandMarkConsent.Root>
                  </Dialog.Popup>
                </Dialog.Viewport>
              </Dialog.Portal>
            </Dialog.Root>

            {mark ? (
              <ConfirmDialog.Root>
                <ConfirmDialog.Trigger
                  render={<Button size="sm" type="button" variant="outline" />}
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.settings.delete" />
                  </Suspense>
                </ConfirmDialog.Trigger>
                <ConfirmDialog.Content>
                  <ConfirmDialog.Header>
                    <ConfirmDialog.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.settings.brand_marks.delete_title" />
                      </Suspense>
                    </ConfirmDialog.Title>
                    <ConfirmDialog.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.brand_marks.delete_description" />
                      </Suspense>
                    </ConfirmDialog.Description>
                  </ConfirmDialog.Header>
                  <ConfirmDialog.Footer>
                    <ConfirmDialog.Cancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </ConfirmDialog.Cancel>
                    <ConfirmDialog.Action
                      form={formId}
                      name="intent"
                      value="delete"
                    >
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.settings.delete_action" />
                      </Suspense>
                    </ConfirmDialog.Action>
                  </ConfirmDialog.Footer>
                </ConfirmDialog.Content>
              </ConfirmDialog.Root>
            ) : null}
          </ActionForm.Fieldset>
        </ActionForm.Root>
      </Card.Content>
    </Card.Root>
  );
};
