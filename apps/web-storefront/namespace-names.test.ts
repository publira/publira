// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import * as CampaignBannerCarousel from "./app/[tenant_id]/[locale]/(site)/_components/campaign-banner-carousel";
import * as WeeklySchedule from "./app/[tenant_id]/[locale]/(site)/_components/weekly-schedule";
import * as PasskeyConfirmation from "./app/[tenant_id]/[locale]/(site)/settings/_components/passkey-confirmation";
import * as PasskeyAddition from "./app/[tenant_id]/[locale]/(site)/settings/security/_components/passkey-addition";
import * as AgeRatingGate from "./components/age-rating-gate";
import * as EpisodeReaction from "./components/episode-reaction";
import * as ErrorScreen from "./components/error-screen";
import * as FollowButton from "./components/follow-button";
import * as ListPagination from "./components/list-pagination";
import * as LocaleSwitcher from "./components/locale-switcher";
import * as NotificationBell from "./components/notification-bell";
import * as SeriesShelf from "./components/series-shelf";

// `getLocale()` is a root-parameter read that only the Next.js compiler can
// provide, and nothing here renders a part.
vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

const namespaces = {
  AgeRatingGate,
  CampaignBannerCarousel,
  EpisodeReaction,
  ErrorScreen,
  FollowButton,
  ListPagination,
  LocaleSwitcher,
  NotificationBell,
  PasskeyAddition,
  PasskeyConfirmation,
  SeriesShelf,
  WeeklySchedule,
};

describe("compound component namespaces", () => {
  // A part is renamed only where its module exports it, so React DevTools,
  // error overlays, and stack traces keep naming the component a part belongs
  // to instead of showing `Root` and `Trigger` for every tree in the app.
  it.each(Object.entries(namespaces))(
    "%s keeps each part's declared name",
    (namespace, parts) => {
      for (const [key, part] of Object.entries(parts)) {
        if (typeof part === "function") {
          expect(part.name, `${namespace}.${key}`).not.toBe(key);
        }
      }
    }
  );
});
