import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import {
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { SubmitGate, SubmitGateSubmit } from "#components/submit-gate";
import { getMessages } from "#lib/get-messages";

import type {
  IssueAccessTicketActionState,
  TicketSeriesOption,
} from "../ticket-types";
import {
  TicketEpisodeCombobox,
  TicketEpisodeInput,
  TicketEpisodeLoadError,
  TicketReaderPicker,
  TicketSeriesCombobox,
  TicketSeriesWhile,
  TicketTarget,
} from "./ticket-target-controls";

interface TicketFormProps {
  action: (
    prevState: IssueAccessTicketActionState,
    formData: FormData
  ) => Promise<IssueAccessTicketActionState>;
  series: TicketSeriesOption[];
  seriesErrorMessage?: string;
  tenantId: string;
  timeZone: string;
}

/**
 * Awaits the catalog for its placeholders and the series choices, which are
 * attributes and option labels rather than nodes. An issued ticket redirects
 * from the Action to the list.
 */
export const TicketForm = async ({
  action,
  series,
  seriesErrorMessage,
  tenantId,
  timeZone,
}: TicketFormProps) => {
  const t = await getMessages();
  const seriesItems = series.map((item) => ({
    label: t("admin.access_tickets.form.option", {
      id: item.publicId,
      title: item.title,
    }),
    value: item.id,
  }));

  return (
    <ActionForm action={action} className="grid gap-5" showSuccess={false}>
      <input name="tenant_id" type="hidden" value={tenantId} />

      <SubmitGate initialSubmittable={false}>
        <ActionFormFieldset className="grid gap-5">
          <TicketTarget seriesItems={seriesItems} tenantId={tenantId}>
            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.form.user" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <TicketReaderPicker />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.access_tickets.form.user_description" />
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.form.series" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                {seriesErrorMessage ? (
                  <FormMessage variant="destructive">
                    {seriesErrorMessage}
                  </FormMessage>
                ) : null}
                <TicketSeriesCombobox>
                  <ComboboxInput
                    placeholder={t(
                      "admin.access_tickets.form.series_placeholder"
                    )}
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.access_tickets.form.series_empty" />
                      </Suspense>
                    </ComboboxEmpty>
                    <ComboboxItems />
                  </ComboboxPopup>
                </TicketSeriesCombobox>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    {series.length === 0 && !seriesErrorMessage ? (
                      <Message message="admin.access_tickets.form.episode_no_series" />
                    ) : (
                      <Message message="admin.access_tickets.form.series_description" />
                    )}
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.form.episode" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <TicketEpisodeCombobox>
                  <TicketEpisodeInput />
                  <ComboboxPopup>
                    <ComboboxEmpty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.access_tickets.form.episode_empty" />
                      </Suspense>
                    </ComboboxEmpty>
                    <ComboboxItems />
                  </ComboboxPopup>
                </TicketEpisodeCombobox>
                <TicketEpisodeLoadError>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.common.retry" />
                  </Suspense>
                </TicketEpisodeLoadError>
                <FieldDescription>
                  <TicketSeriesWhile chosen={false}>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.access_tickets.form.episode_needs_series" />
                    </Suspense>
                  </TicketSeriesWhile>
                  <TicketSeriesWhile chosen>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.access_tickets.form.episode_description" />
                    </Suspense>
                  </TicketSeriesWhile>
                </FieldDescription>
              </FieldContent>
            </Field>
          </TicketTarget>

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.access_tickets.form.expires_at" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <InstantInput name="expires_at" timeZone={timeZone} />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message
                    message="admin.access_tickets.form.expires_at_description"
                    values={{ time_zone: timeZone }}
                  />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.access_tickets.form.note" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Textarea
                maxLength={1000}
                name="note"
                placeholder={t("admin.access_tickets.form.note_placeholder")}
                rows={3}
              />
            </FieldContent>
          </Field>
        </ActionFormFieldset>

        <div className="flex justify-end">
          <SubmitGateSubmit>
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.access_tickets.form.submit" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.access_tickets.form.submitting" />
              </Suspense>
            </ActionFormPending>
          </SubmitGateSubmit>
        </div>
      </SubmitGate>
    </ActionForm>
  );
};
