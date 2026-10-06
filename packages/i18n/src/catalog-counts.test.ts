import { describe, expect, it } from "vitest";

import { sharedCatalog } from "./catalog";
import type { SharedMessages } from "./catalog";
import { bindMessages } from "./i18n";
import type { MessageKey, MessageValues } from "./i18n";

const en = bindMessages(sharedCatalog("en"), "en");
const ja = bindMessages(sharedCatalog("ja"), "ja");

interface CountCase {
  readonly key: MessageKey<SharedMessages>;
  /** The values besides the count, which is `variable`. */
  readonly values?: MessageValues;
  readonly variable?: string;
  readonly one: string;
  readonly many: string;
}

// Every web message whose noun follows a count that can be 1 at runtime, at 1
// and at a count that groups its digits. The Flutter catalog's are covered by
// the app's own tests.
const cases: CountCase[] = [
  {
    key: "admin.auth.mfa.recovery_used_description",
    many: "1,200 recovery codes are left. Regenerate them from your account settings once your authenticator is back.",
    one: "1 recovery code is left. Regenerate your codes from your account settings once your authenticator is back.",
  },
  {
    key: "admin.settings.mfa.remaining_recovery_codes",
    many: "1,200 recovery codes left",
    one: "1 recovery code left",
  },
  {
    key: "admin.nav.comments_pending",
    many: "1,200 comments awaiting approval",
    one: "1 comment awaiting approval",
  },
  {
    key: "admin.comments.purge_due_days",
    many: "Purged for good in 1,200 days, on Jun 8, 2026.",
    one: "Purged for good in 1 day, on Jun 8, 2026.",
    values: { at: "Jun 8, 2026" },
    variable: "days",
  },
  {
    key: "admin.comments.reports.open_count",
    many: "1,200 reports still waiting",
    one: "1 report still waiting",
  },
  {
    key: "admin.settings.policy.retention.platform_days",
    many: "Platform default: 1,200 days",
    one: "Platform default: 1 day",
    variable: "days",
  },
  {
    key: "admin.settings.policy.community.platform_window",
    many: "Platform window: 1,200 minutes",
    one: "Platform window: 1 minute",
    variable: "minutes",
  },
  {
    key: "admin.series.episodes.credits.selection_count",
    many: "1,200 episodes selected.",
    one: "1 episode selected.",
  },
  {
    key: "admin.series.episodes.credits.preview_add",
    many: "Add Artist B as Artist to 1,200 selected episodes.",
    one: "Add Artist B as Artist to 1 selected episode.",
    values: { creator: "Artist B", role: "Artist" },
  },
  {
    key: "admin.series.episodes.credits.preview_replace",
    many: "Replace Artist B as Artist with Artist C as Artist on 1,200 selected episodes.",
    one: "Replace Artist B as Artist with Artist C as Artist on 1 selected episode.",
    values: {
      from_creator: "Artist B",
      from_role: "Artist",
      to_creator: "Artist C",
      to_role: "Artist",
    },
  },
  {
    key: "admin.series.episodes.credits.preview_remove",
    many: "Remove Artist B as Artist from 1,200 selected episodes.",
    one: "Remove Artist B as Artist from 1 selected episode.",
    values: { creator: "Artist B", role: "Artist" },
  },
  {
    key: "admin.series.episodes.credits.preview_set_share",
    many: "Set the share of Artist B as Artist to 25% on 1,200 selected episodes.",
    one: "Set the share of Artist B as Artist to 25% on 1 selected episode.",
    values: { creator: "Artist B", role: "Artist", share: "25%" },
  },
  {
    key: "admin.series.episodes.credits.result_changed",
    many: "Changed 1,200 episodes",
    one: "Changed 1 episode",
  },
  {
    key: "admin.series.episodes.credits.result_unchanged",
    many: "Left 1,200 episodes unchanged",
    one: "Left 1 episode unchanged",
  },
  {
    key: "admin.series.episodes.free_windows.target_selected_description",
    many: "1,200 episodes selected on the list.",
    one: "1 episode selected on the list.",
  },
  {
    key: "admin.series.episodes.free_windows.bulk_created",
    many: "Added a free reading period to 1,200 episodes.",
    one: "Added a free reading period to 1 episode.",
  },
  {
    key: "host.common.free_episode_count",
    many: "1,200 free episodes",
    one: "1 free episode",
  },
  {
    key: "host.episode.page_count_value",
    many: "1,200 pages",
    one: "1 page",
  },
  {
    key: "host.episode.reading_period_hours",
    many: "1,200 hours",
    one: "1 hour",
    variable: "hours",
  },
  {
    key: "host.series.episode_count",
    many: "1,200 episodes",
    one: "1 episode",
  },
  {
    key: "host.series.rating.public",
    many: "Rating: 3.5 · 1,200 readers",
    one: "Rating: 3.5 · 1 reader",
    values: { average: "3.5" },
  },
];

describe("count-dependent copy", () => {
  it.each(cases)("words $key for one and for many in English", (entry) => {
    const variable = entry.variable ?? "count";
    expect(en(entry.key, { ...entry.values, [variable]: 1 })).toBe(entry.one);
    expect(en(entry.key, { ...entry.values, [variable]: 1200 })).toBe(
      entry.many
    );
  });

  it("writes one form for every count in a locale with no plural categories", () => {
    expect(ja("host.series.episode_count", { count: 1 })).toBe("全1話");
    expect(ja("host.series.episode_count", { count: 1200 })).toBe("全1,200話");
  });
});
