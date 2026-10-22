import {
  ActionForm,
  ActionFormFieldError,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Identifier, IdentifierValue } from "@publira/ui-components/identifier";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
} from "#components/admin-page";
import { Message } from "#components/message";
import { gatewayTagId } from "#lib/tenant-analytics-settings-shared";
import type { TenantAnalyticsSettings } from "#lib/tenant-analytics-settings-shared";

import { updateGoogleTagAction } from "../_lib/actions";
import {
  GatewayPathCopy,
  GoogleTagModeRadioGroup,
  GoogleTagModeScope,
  GoogleTagModeWhile,
  ServerContainerUrlInput,
} from "./google-tag-controls";

const FORM_ID = "google-tag-form";

/** The path the gateway answers on, or what has to happen for it to exist. */
const GatewayPath = ({ gatewayPath }: { gatewayPath: string }) => {
  if (!gatewayPath) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.settings.google_tag.gateway_path_unset" />
        </Suspense>
      </p>
    );
  }

  const path = `/${gatewayPath}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Identifier>
        <IdentifierValue>{path}</IdentifierValue>
        <GatewayPathCopy value={path} />
      </Identifier>
      <ActionFormFieldset>
        <ConfirmDialog>
          <ConfirmDialogTrigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.settings.google_tag.gateway_path_regenerate" />
            </Suspense>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.settings.google_tag.gateway_path_regenerate_title" />
                </Suspense>
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.google_tag.gateway_path_regenerate_description" />
                </Suspense>
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialogCancel>
              <ConfirmDialogAction
                form={FORM_ID}
                name="regenerate_gateway_path"
                value="on"
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.settings.google_tag.gateway_path_regenerate_action" />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </div>
  );
};

interface GoogleTagFormProps {
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantAnalyticsSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const GoogleTagForm = ({
  initialSettings: settings,
  loadErrorMessage,
  tenantId,
}: GoogleTagFormProps) => {
  const tagId = settings === undefined ? "" : gatewayTagId(settings);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.google_tag.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] xl:items-start">
        <ActionForm
          action={updateGoogleTagAction}
          className="grid gap-6"
          id={FORM_ID}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />

          {settings === undefined ? null : (
            // A save refreshes the settings; keying on them remounts the
            // fields on what the API stored instead of changing a mounted
            // default.
            <GoogleTagModeScope
              initialServerContainerUrl={settings.serverContainerUrl}
              initialServingMode={settings.servingMode}
              key={JSON.stringify(settings)}
            >
              <ActionFormFieldset className="grid gap-6">
                <Field>
                  <FieldLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.settings.google_tag.measurement_id" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      autoCapitalize="characters"
                      autoComplete="off"
                      defaultValue={settings.ga4MeasurementId}
                      name="ga4_measurement_id"
                      placeholder="G-XXXXXXXXXX"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="ga4MeasurementId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.google_tag.measurement_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.settings.google_tag.container_id" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      autoCapitalize="characters"
                      autoComplete="off"
                      defaultValue={settings.gtmContainerId}
                      name="gtm_container_id"
                      placeholder="GTM-XXXXXXX"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="gtmContainerId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.google_tag.container_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.settings.google_tag.serving_mode" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <GoogleTagModeRadioGroup
                      items={[
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.google.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.google.label" />
                            </Suspense>
                          ),
                          value: "google",
                        },
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.server_container.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.server_container.label" />
                            </Suspense>
                          ),
                          value: "server_container",
                        },
                        {
                          description: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-64" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.gateway.description" />
                            </Suspense>
                          ),
                          label: (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <Message message="admin.settings.google_tag.serving_modes.gateway.label" />
                            </Suspense>
                          ),
                          value: "gateway",
                        },
                      ]}
                    />
                    <ActionFormFieldError name="servingMode" />
                  </FieldContent>
                </Field>

                <GoogleTagModeWhile mode="server_container">
                  <Field>
                    <FieldLabel required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.google_tag.server_container_url" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <ServerContainerUrlInput />
                      <ActionFormFieldError name="serverContainerUrl" />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.google_tag.server_container_url_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </GoogleTagModeWhile>
              </ActionFormFieldset>

              <GoogleTagModeWhile mode="gateway">
                <div className="grid gap-6">
                  {/* Registered in Google Tag Manager rather than typed here,
                      so they sit outside the fields a save submits. */}
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.google_tag.gateway_path" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <GatewayPath gatewayPath={settings.gatewayPath} />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.google_tag.gateway_path_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.settings.google_tag.gateway_tag_id" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      {tagId ? (
                        <IdentifierValue>{tagId}</IdentifierValue>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-64" />}
                          >
                            <Message message="admin.settings.google_tag.gateway_tag_id_unset" />
                          </Suspense>
                        </p>
                      )}
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.google_tag.gateway_tag_id_description" />
                        </Suspense>
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <ActionFormFieldset>
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.google_tag.server_container_url" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <ServerContainerUrlInput />
                        <ActionFormFieldError name="serverContainerUrl" />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.google_tag.gateway_server_container_url_description" />
                          </Suspense>
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </ActionFormFieldset>
                </div>
              </GoogleTagModeWhile>
            </GoogleTagModeScope>
          )}

          {loadErrorMessage ? (
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <ActionFormSubmit disabled={settings === undefined}>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ActionFormIdle>
                  <Message message="admin.settings.google_tag.submit" />
                </ActionFormIdle>
                <ActionFormPending>
                  <Message message="admin.settings.saving" />
                </ActionFormPending>
              </Suspense>
            </ActionFormSubmit>
          </div>
        </ActionForm>
        <aside className="grid gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.google_tag.guidance.title" />
            </Suspense>
          </h2>
          <ul className="grid list-disc gap-2 pl-5 text-sm text-muted-foreground">
            <li>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.settings.google_tag.guidance.other_tags" />
              </Suspense>
            </li>
            <li>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.settings.google_tag.guidance.double_counting" />
              </Suspense>
            </li>
            <li>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.settings.google_tag.guidance.privacy_page" />
              </Suspense>
            </li>
          </ul>
        </aside>
      </div>
    </AdminSection>
  );
};
