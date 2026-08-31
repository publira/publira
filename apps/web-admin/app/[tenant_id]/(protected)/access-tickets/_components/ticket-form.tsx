"use client";

import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { Combobox } from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import {
  useActionState,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import { listEpisodeOptionsAction } from "../_lib/actions";
import type {
  IssueAccessTicketActionState,
  TicketEpisodeOption,
  TicketSeriesOption,
} from "../ticket-types";

interface TicketFormProps {
  action: (
    prevState: IssueAccessTicketActionState,
    formData: FormData
  ) => Promise<IssueAccessTicketActionState>;
  series: TicketSeriesOption[];
  seriesErrorMessage?: string;
  timeZone: string;
}

const toSeriesItems = (
  series: TicketSeriesOption[],
  messages: SharedMessages
): ComboboxItem[] =>
  series.map((item) => ({
    label: getMessage(messages, "admin.access_tickets.form.option", {
      id: item.publicId,
      title: item.title,
    }),
    value: item.publicId,
  }));

const toEpisodeItems = (
  episodes: TicketEpisodeOption[],
  messages: SharedMessages
): ComboboxItem[] =>
  episodes.map((item) => ({
    label: getMessage(messages, "admin.access_tickets.form.option", {
      id: item.publicId,
      title: item.title,
    }),
    value: item.publicId,
  }));

export const TicketForm = ({
  action,
  series,
  seriesErrorMessage,
  timeZone,
}: TicketFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [isEpisodePending, startEpisodeTransition] = useTransition();
  const [seriesPublicId, setSeriesPublicId] = useState("");
  const [episodePublicId, setEpisodePublicId] = useState("");
  const [episodes, setEpisodes] = useState<TicketEpisodeOption[]>([]);
  const [episodesErrorMessage, setEpisodesErrorMessage] = useState<string>();
  const episodeRequestIdRef = useRef(0);

  const seriesItems = useMemo(
    () => toSeriesItems(series, messages),
    [messages, series]
  );
  const episodeItems = useMemo(
    () => toEpisodeItems(episodes, messages),
    [episodes, messages]
  );
  // Only the missing catalog falls back to a public_id field. An episode-list
  // failure must keep the pickers so the operator can retry without a reload.
  const useEpisodeFallbackInput =
    Boolean(seriesErrorMessage) || seriesItems.length === 0;
  const canSubmit =
    !isPending &&
    !isEpisodePending &&
    (useEpisodeFallbackInput || episodePublicId !== "");

  const loadEpisodesForSeries = useCallback(
    (nextSeriesPublicId: string) => {
      const requestId = episodeRequestIdRef.current + 1;
      episodeRequestIdRef.current = requestId;

      startEpisodeTransition(async () => {
        const result = await listEpisodeOptionsAction(
          tenantId,
          nextSeriesPublicId,
          locale
        );
        if (requestId !== episodeRequestIdRef.current) {
          return;
        }
        if (result.ok) {
          setEpisodes(result.episodes);
          setEpisodesErrorMessage(undefined);
          return;
        }
        setEpisodesErrorMessage(result.message);
      });
    },
    [locale, tenantId]
  );

  const handleSeriesChange = useCallback(
    (nextSeriesPublicId: string) => {
      setSeriesPublicId(nextSeriesPublicId);
      setEpisodePublicId("");
      setEpisodes([]);
      setEpisodesErrorMessage(undefined);

      if (nextSeriesPublicId === "") {
        return;
      }

      loadEpisodesForSeries(nextSeriesPublicId);
    },
    [loadEpisodesForSeries]
  );

  const handleRetryEpisodes = useCallback(() => {
    if (seriesPublicId === "") {
      return;
    }
    setEpisodesErrorMessage(undefined);
    loadEpisodesForSeries(seriesPublicId);
  }, [loadEpisodesForSeries, seriesPublicId]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "expires_at",
        localName: "expires_at_local",
        timeZone,
      });
    },
    [timeZone]
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          action={formAction}
          className="grid gap-5"
          onSubmit={handleSubmit}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel required>
              {getMessage(messages, "admin.access_tickets.form.user")}
            </FieldLabel>
            <FieldContent>
              <Input
                name="user_public_id"
                placeholder={getMessage(
                  messages,
                  "admin.access_tickets.form.user_placeholder"
                )}
                required
                type="text"
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.access_tickets.form.user_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          {useEpisodeFallbackInput ? (
            <Field>
              <FieldLabel required>
                {getMessage(messages, "admin.access_tickets.form.episode_id")}
              </FieldLabel>
              <FieldContent>
                {seriesErrorMessage ? (
                  <FormMessage variant="destructive">
                    {seriesErrorMessage}
                  </FormMessage>
                ) : null}
                <Input
                  name="episode_public_id"
                  placeholder={getMessage(
                    messages,
                    "admin.access_tickets.form.episode_id_placeholder"
                  )}
                  required
                  type="text"
                />
                <FieldDescription>
                  {getMessage(
                    messages,
                    seriesItems.length === 0 && !seriesErrorMessage
                      ? "admin.access_tickets.form.episode_id_no_series"
                      : "admin.access_tickets.form.episode_id_description"
                  )}
                </FieldDescription>
              </FieldContent>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel required>
                  {getMessage(messages, "admin.access_tickets.form.series")}
                </FieldLabel>
                <FieldContent>
                  <Combobox
                    emptyMessage={getMessage(
                      messages,
                      "admin.access_tickets.form.series_empty"
                    )}
                    items={seriesItems}
                    onValueChange={handleSeriesChange}
                    placeholder={getMessage(
                      messages,
                      "admin.access_tickets.form.series_placeholder"
                    )}
                    value={seriesPublicId}
                  />
                  <FieldDescription>
                    {getMessage(
                      messages,
                      "admin.access_tickets.form.series_description"
                    )}
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel required>
                  {getMessage(messages, "admin.access_tickets.form.episode")}
                </FieldLabel>
                <FieldContent>
                  <Combobox
                    disabled={isEpisodePending || seriesPublicId === ""}
                    emptyMessage={getMessage(
                      messages,
                      "admin.access_tickets.form.episode_empty"
                    )}
                    items={episodeItems}
                    onValueChange={setEpisodePublicId}
                    placeholder={getMessage(
                      messages,
                      isEpisodePending
                        ? "admin.access_tickets.form.episode_loading"
                        : "admin.access_tickets.form.episode_placeholder"
                    )}
                    value={episodePublicId}
                  />
                  <input
                    name="episode_public_id"
                    type="hidden"
                    value={episodePublicId}
                  />
                  {episodesErrorMessage ? (
                    <>
                      <FormMessage variant="destructive">
                        {episodesErrorMessage}
                      </FormMessage>
                      <Button
                        onClick={handleRetryEpisodes}
                        type="button"
                        variant="outline"
                      >
                        {getMessage(messages, "admin.common.retry")}
                      </Button>
                    </>
                  ) : null}
                  <FieldDescription>
                    {getMessage(
                      messages,
                      seriesPublicId === ""
                        ? "admin.access_tickets.form.episode_needs_series"
                        : "admin.access_tickets.form.episode_description"
                    )}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </>
          )}

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.access_tickets.form.expires_at")}
            </FieldLabel>
            <FieldContent>
              <Input name="expires_at_local" type="datetime-local" />
              <input defaultValue="" name="expires_at" type="hidden" />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.access_tickets.form.expires_at_description",
                  { time_zone: timeZone }
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.access_tickets.form.note")}
            </FieldLabel>
            <FieldContent>
              <Textarea
                maxLength={1000}
                name="note"
                placeholder={getMessage(
                  messages,
                  "admin.access_tickets.form.note_placeholder"
                )}
                rows={3}
              />
            </FieldContent>
          </Field>

          {state && !state.ok ? (
            <FormMessage variant="destructive">{state.message}</FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={!canSubmit} type="submit">
              {isPending
                ? getMessage(messages, "admin.access_tickets.form.submitting")
                : getMessage(messages, "admin.access_tickets.form.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
