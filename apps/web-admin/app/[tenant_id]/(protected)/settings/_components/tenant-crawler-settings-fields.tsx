"use client";

import {
  useActionFormSettled,
  useActionFormState,
} from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
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
import type { KnownCrawler } from "#lib/tenant-crawler-settings-shared";

import type { TenantCrawlerSettingsActionState } from "../settings-types";
import { EntryListFields } from "./entry-list-fields";

type SettledState = NonNullable<TenantCrawlerSettingsActionState>;

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
  const t = useClientMessages();
  const crawlersDescriptionId = useId();
  const state = useActionFormState<SettledState>();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(
    () => new Set(initialSettings?.excludedUserAgents)
  );
  const [paths, setPaths] = useState(
    () => initialSettings?.excludedPaths ?? []
  );
  // Bumped by each save, which remounts the list on what the server stored.
  const [savedCount, setSavedCount] = useState(0);

  useActionFormSettled<SettledState>((settled) => {
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

  // One field read as a list of one: blank is no entry, and anything else
  // is checked as the Action checks it.
  const pathError = (value: string) => {
    const result = parseCrawlerPaths([value]);
    return result.ok || result.reason === "too_many"
      ? undefined
      : crawlerPathMessage(t, result);
  };

  const pathsError = (values: readonly string[]) => {
    const list = parseCrawlerPaths(values);
    if (!list.ok && list.reason === "too_many") {
      return t("admin.settings.crawlers.validation.too_many", {
        max: MAX_CRAWLER_EXCLUDED_PATHS,
      });
    }
    return state?.ok === false ? state.fieldErrors?.excludedPaths : undefined;
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
            <legend className="text-sm font-medium text-foreground">
              <ClientMessage
                message={`admin.settings.crawlers.purposes.${purpose}.label`}
              />
            </legend>
            <p className="text-xs text-muted-foreground">
              <ClientMessage
                message={`admin.settings.crawlers.purposes.${purpose}.description`}
              />
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {crawlers.map((crawler) => (
                <li key={crawler.userAgent}>
                  <Field className="grid-cols-[auto_1fr] items-start gap-x-2 gap-y-0.5">
                    <Checkbox
                      checked={excluded.has(crawler.userAgent)}
                      className="row-span-2 mt-0.5"
                      name="excluded_user_agents"
                      onCheckedChange={(checked) => {
                        setCrawlerExcluded(crawler.userAgent, checked);
                      }}
                      value={crawler.userAgent}
                    />
                    <FieldLabel>{crawler.userAgent}</FieldLabel>
                    <FieldDescription className="col-start-2">
                      <ClientMessage
                        message="admin.settings.crawlers.crawler_operator"
                        values={{ operator: crawler.operator }}
                      />
                    </FieldDescription>
                  </Field>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}

        {crawlersError === undefined ? null : (
          <FormMessage variant="destructive">{crawlersError}</FormMessage>
        )}
      </fieldset>

      <EntryListFields
        addLabel={<ClientMessage message="admin.settings.crawlers.paths_add" />}
        description={
          <ClientMessage message="admin.settings.crawlers.paths_description" />
        }
        entryError={pathError}
        entryLabel={(position) =>
          t("admin.settings.crawlers.path_label", { position })
        }
        initialEntries={paths}
        key={savedCount}
        legend={<ClientMessage message="admin.settings.crawlers.paths_label" />}
        listError={pathsError}
        name="excluded_paths"
        removeLabel={(position) =>
          t("admin.settings.crawlers.path_remove", { position })
        }
      />
    </>
  );
};
