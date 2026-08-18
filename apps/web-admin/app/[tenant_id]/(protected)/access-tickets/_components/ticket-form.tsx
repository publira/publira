"use client";

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
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

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

const toSeriesItems = (series: TicketSeriesOption[]): ComboboxItem[] =>
  series.map((item) => ({
    label: `${item.title} (${item.publicId})`,
    value: item.publicId,
  }));

const toEpisodeItems = (episodes: TicketEpisodeOption[]): ComboboxItem[] =>
  episodes.map((item) => ({
    label: `${item.title} (${item.publicId})`,
    value: item.publicId,
  }));

export const TicketForm = ({
  action,
  series,
  seriesErrorMessage,
  timeZone,
}: TicketFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [isEpisodePending, startEpisodeTransition] = useTransition();
  const [seriesPublicId, setSeriesPublicId] = useState("");
  const [episodePublicId, setEpisodePublicId] = useState("");
  const [episodes, setEpisodes] = useState<TicketEpisodeOption[]>([]);
  const [episodesErrorMessage, setEpisodesErrorMessage] = useState<string>();
  const episodeRequestIdRef = useRef(0);

  const seriesItems = useMemo(() => toSeriesItems(series), [series]);
  const episodeItems = useMemo(() => toEpisodeItems(episodes), [episodes]);
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
          nextSeriesPublicId
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
    [tenantId]
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
            <FieldLabel required>ユーザー public_id</FieldLabel>
            <FieldContent>
              <Input
                name="user_public_id"
                placeholder="例: SeedMMBRAAA1"
                required
                type="text"
              />
              <FieldDescription>
                閲覧権を付与するエンドユーザーの public_id を入力します。
              </FieldDescription>
            </FieldContent>
          </Field>

          {useEpisodeFallbackInput ? (
            <Field>
              <FieldLabel required>エピソード public_id</FieldLabel>
              <FieldContent>
                {seriesErrorMessage ? (
                  <FormMessage variant="destructive">
                    {seriesErrorMessage}
                  </FormMessage>
                ) : null}
                <Input
                  name="episode_public_id"
                  placeholder="例: SeedEPSDAAA1"
                  required
                  type="text"
                />
                <FieldDescription>
                  {seriesItems.length === 0 && !seriesErrorMessage
                    ? "選択できるシリーズがありません。エピソードの public_id を直接入力してください。"
                    : "対象エピソードの public_id を入力します。"}
                </FieldDescription>
              </FieldContent>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel required>シリーズ</FieldLabel>
                <FieldContent>
                  <Combobox
                    emptyMessage="一致するシリーズが見つかりません。"
                    items={seriesItems}
                    onValueChange={handleSeriesChange}
                    placeholder="シリーズ名で検索"
                    value={seriesPublicId}
                  />
                  <FieldDescription>
                    対象エピソードが属するシリーズを選ぶと、エピソード一覧が開きます。
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel required>エピソード</FieldLabel>
                <FieldContent>
                  <Combobox
                    disabled={isEpisodePending || seriesPublicId === ""}
                    emptyMessage="一致するエピソードが見つかりません。"
                    items={episodeItems}
                    onValueChange={setEpisodePublicId}
                    placeholder={
                      isEpisodePending ? "読み込み中…" : "エピソード名で検索"
                    }
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
                        再試行
                      </Button>
                    </>
                  ) : null}
                  <FieldDescription>
                    {seriesPublicId === ""
                      ? "先にシリーズを選択してください。"
                      : "閲覧権を付与するエピソードを選択します。"}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </>
          )}

          <Field>
            <FieldLabel>有効期限</FieldLabel>
            <FieldContent>
              <Input name="expires_at_local" type="datetime-local" />
              <input defaultValue="" name="expires_at" type="hidden" />
              <FieldDescription>
                未指定の場合は無期限です。テナントのタイムゾーン（{timeZone}
                ）の壁時計として解釈し、送信時に絶対時刻へ変換します。失効操作でいつでも取り消せます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>メモ</FieldLabel>
            <FieldContent>
              <Textarea
                maxLength={1000}
                name="note"
                placeholder="例: レビュー用の限定閲覧"
                rows={3}
              />
            </FieldContent>
          </Field>

          {state && !state.ok ? (
            <FormMessage variant="destructive">{state.message}</FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={!canSubmit} type="submit">
              {isPending ? "発行中…" : "チケットを発行"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
