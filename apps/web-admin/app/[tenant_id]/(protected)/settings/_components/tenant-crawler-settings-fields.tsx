"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { useId, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { TenantCrawlerSettings } from "#lib/tenant-crawler-settings";
import {
  CRAWLER_PURPOSES,
  crawlerPathMessage,
  MAX_CRAWLER_EXCLUDED_PATHS,
  parseCrawlerPaths,
} from "#lib/tenant-crawler-settings-shared";
import type {
  CrawlerPurpose,
  KnownCrawler,
} from "#lib/tenant-crawler-settings-shared";

import type { TenantCrawlerSettingsActionState } from "../settings-types";
import * as EntryList from "./entry-list";

type SettledState = NonNullable<TenantCrawlerSettingsActionState>;

const PURPOSE_LEGEND_CLASS = "text-sm font-medium text-foreground";
const PURPOSE_DESCRIPTION_CLASS = "text-xs text-muted-foreground";

/** The legend and the line under it of one purpose's group. */
const CrawlerPurposeHeading = ({ purpose }: { purpose: CrawlerPurpose }) => {
  switch (purpose) {
    case "ai_training": {
      return (
        <>
          <legend className={PURPOSE_LEGEND_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.ai_training.label" />
          </legend>
          <p className={PURPOSE_DESCRIPTION_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.ai_training.description" />
          </p>
        </>
      );
    }
    case "ai_assistant": {
      return (
        <>
          <legend className={PURPOSE_LEGEND_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.ai_assistant.label" />
          </legend>
          <p className={PURPOSE_DESCRIPTION_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.ai_assistant.description" />
          </p>
        </>
      );
    }
    case "image_search": {
      return (
        <>
          <legend className={PURPOSE_LEGEND_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.image_search.label" />
          </legend>
          <p className={PURPOSE_DESCRIPTION_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.image_search.description" />
          </p>
        </>
      );
    }
    default: {
      return (
        <>
          <legend className={PURPOSE_LEGEND_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.other.label" />
          </legend>
          <p className={PURPOSE_DESCRIPTION_CLASS}>
            <ClientMessage message="admin.settings.crawlers.purposes.other.description" />
          </p>
        </>
      );
    }
  }
};

/**
 * One path, named once the operator has left its field. The field is read as
 * a list of one, so blank is no entry and anything else is checked as the
 * Action checks it.
 */
const CrawlerPath = () => {
  const t = useClientMessages();
  const { position, touched, value } = EntryList.useRow();
  const result = parseCrawlerPaths([value]);
  const message =
    touched && !result.ok && result.reason !== "too_many"
      ? crawlerPathMessage(t, result)
      : undefined;

  return (
    <>
      <EntryList.Field invalid={message !== undefined}>
        <EntryList.Input
          aria-label={t("admin.settings.crawlers.path_label", { position })}
          name="excluded_paths"
        />
        {message === undefined ? null : (
          <FormMessage variant="destructive">{message}</FormMessage>
        )}
      </EntryList.Field>
      <EntryList.Remove
        aria-label={t("admin.settings.crawlers.path_remove", { position })}
      />
    </>
  );
};

/** A list longer than the server keeps, or the server's refusal of it. */
const CrawlerPathsMessage = () => {
  const t = useClientMessages();
  const state = ActionForm.useState<SettledState>();
  const list = parseCrawlerPaths(EntryList.useValues());

  if (!list.ok && list.reason === "too_many") {
    return (
      <EntryList.Message>
        {t("admin.settings.crawlers.validation.too_many", {
          max: MAX_CRAWLER_EXCLUDED_PATHS,
        })}
      </EntryList.Message>
    );
  }
  return (
    <EntryList.Message>
      {state?.ok === false ? state.fieldErrors?.excludedPaths : undefined}
    </EntryList.Message>
  );
};

interface TenantCrawlerSettingsFieldsProps {
  /** Every crawler the setting may name, absent when the setting was not read. */
  knownCrawlers?: readonly KnownCrawler[];
  /** The saved setting, absent when it was not read. */
  initialSettings?: TenantCrawlerSettings;
}

/**
 * The crawlers, ticked from the list the server offers and grouped by what
 * they fetch pages for, and the paths, one per field. Each path is checked once
 * the operator leaves it, with the rule the server applies. A save answers the
 * paths as the server stored them, which is what the fields then hold.
 */
export const TenantCrawlerSettingsFields = ({
  initialSettings,
  knownCrawlers,
}: TenantCrawlerSettingsFieldsProps) => {
  const crawlersDescriptionId = useId();
  const state = ActionForm.useState<SettledState>();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(
    () => new Set(initialSettings?.excludedUserAgents)
  );
  const [paths, setPaths] = useState(
    () => initialSettings?.excludedPaths ?? []
  );
  // Bumped by each save, which remounts the list on what the server stored.
  const [savedCount, setSavedCount] = useState(0);

  ActionForm.useSettled<SettledState>((settled) => {
    if (!settled?.ok) {
      return;
    }
    setExcluded(new Set(settled.settings.excludedUserAgents));
    setPaths(settled.settings.excludedPaths);
    setSavedCount((count) => count + 1);
  });

  const setCrawlerExcluded = (userAgent: string, checked: boolean) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(userAgent);
      } else {
        next.delete(userAgent);
      }
      return next;
    });
  };

  const crawlersError =
    state?.ok === false ? state.fieldErrors?.excludedUserAgents : undefined;

  const groups = CRAWLER_PURPOSES.flatMap((purpose) => {
    const crawlers =
      knownCrawlers?.filter((crawler) => crawler.purpose === purpose) ?? [];
    return crawlers.length > 0 ? [{ crawlers, purpose }] : [];
  });

  return (
    <>
      <fieldset
        aria-describedby={crawlersDescriptionId}
        className="grid min-w-0 gap-4"
      >
        <legend className="mb-1 text-sm font-medium text-foreground">
          <ClientMessage message="admin.settings.crawlers.crawlers_label" />
        </legend>
        <p className="text-xs text-muted-foreground" id={crawlersDescriptionId}>
          <ClientMessage message="admin.settings.crawlers.crawlers_description" />
        </p>

        {groups.map(({ crawlers, purpose }) => (
          <fieldset className="grid min-w-0 gap-2" key={purpose}>
            <CrawlerPurposeHeading purpose={purpose} />
            <ul className="grid gap-2 sm:grid-cols-2">
              {crawlers.map((crawler) => (
                <li key={crawler.userAgent}>
                  <Field.Root className="grid-cols-[auto_1fr] items-start gap-x-2 gap-y-0.5">
                    <Checkbox
                      checked={excluded.has(crawler.userAgent)}
                      className="row-span-2 mt-0.5"
                      name="excluded_user_agents"
                      onCheckedChange={(checked) => {
                        setCrawlerExcluded(crawler.userAgent, checked);
                      }}
                      value={crawler.userAgent}
                    />
                    <Field.Label>{crawler.userAgent}</Field.Label>
                    <Field.Description className="col-start-2">
                      <ClientMessage
                        message="admin.settings.crawlers.crawler_operator"
                        values={{ operator: crawler.operator }}
                      />
                    </Field.Description>
                  </Field.Root>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}

        {crawlersError === undefined ? null : (
          <FormMessage variant="destructive">{crawlersError}</FormMessage>
        )}
      </fieldset>

      <EntryList.Root initialEntries={paths} key={savedCount}>
        <EntryList.Legend>
          <ClientMessage message="admin.settings.crawlers.paths_label" />
        </EntryList.Legend>
        <EntryList.Rows>
          <CrawlerPath />
        </EntryList.Rows>
        <EntryList.Add>
          <ClientMessage message="admin.settings.crawlers.paths_add" />
        </EntryList.Add>
        <EntryList.Description>
          <ClientMessage message="admin.settings.crawlers.paths_description" />
        </EntryList.Description>
        <CrawlerPathsMessage />
      </EntryList.Root>
    </>
  );
};
