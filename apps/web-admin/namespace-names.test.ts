// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import * as AnnouncementPinned from "./app/[tenant_id]/(protected)/announcements/_components/announcement-pinned-controls";
import * as ThemeSettings from "./app/[tenant_id]/(protected)/branding/_components/theme-settings-fields";
import * as CreatorIcon from "./app/[tenant_id]/(protected)/creators/_components/creator-icon-controls";
import * as AppLinksPlatform from "./app/[tenant_id]/(protected)/integrations/app-links/_components/app-links-controls";
import * as SmtpOverride from "./app/[tenant_id]/(protected)/integrations/email/_components/smtp-override";
import * as SmtpPassword from "./app/[tenant_id]/(protected)/integrations/email/_components/smtp-password";
import * as SmtpTest from "./app/[tenant_id]/(protected)/integrations/email/_components/smtp-test";
import * as GoogleTagMode from "./app/[tenant_id]/(protected)/integrations/google-tag/_components/google-tag-controls";
import * as PageDraft from "./app/[tenant_id]/(protected)/pages/_components/page-draft-controls";
import * as RefundReason from "./app/[tenant_id]/(protected)/purchases/_components/refund-reason";
import * as RoyaltyCloseMode from "./app/[tenant_id]/(protected)/royalties/settings/_components/royalty-close-mode-fields";
import * as EpisodePages from "./app/[tenant_id]/(protected)/series/[series_id]/episodes/[episode_id]/_components/episode-pages-upload-controls";
import * as SpreadStart from "./app/[tenant_id]/(protected)/series/[series_id]/episodes/[episode_id]/_components/episode-reading-layout-controls";
import * as SeriesCreatorCredits from "./app/[tenant_id]/(protected)/series/_components/series-creator-credits-field";
import * as SeriesEyeCatch from "./app/[tenant_id]/(protected)/series/_components/series-eye-catch-upload";
import * as SeriesSchedule from "./app/[tenant_id]/(protected)/series/_components/series-schedule-field";
import * as EntryList from "./app/[tenant_id]/(protected)/settings/_components/entry-list";
import * as MfaSettingsOutcome from "./app/[tenant_id]/(protected)/settings/_components/mfa-settings-outcome";
import * as PasskeyAddition from "./app/[tenant_id]/(protected)/settings/_components/passkey-addition";
import * as LegalPage from "./app/[tenant_id]/(protected)/settings/_components/tenant-legal-page-picker";
import * as PolicyOverride from "./app/[tenant_id]/(protected)/settings/policy/_components/policy-override-group";
import * as ReaderIconPolicySelection from "./app/[tenant_id]/(protected)/settings/reader-icons/_components/reader-icon-policy-selection";
import * as MfaEnrollSteps from "./app/[tenant_id]/mfa/_components/mfa-enroll-steps";
import * as MfaVerifyMethods from "./app/[tenant_id]/mfa/_components/mfa-verify-methods";
import * as MfaVerifySteps from "./app/[tenant_id]/mfa/_components/mfa-verify-steps";
import * as TicketTarget from "./components/access-ticket-target";
import * as CredentialsEnabled from "./components/credentials-enabled";
import * as ErrorScreen from "./components/error-screen";
import * as EyeCatchAspect from "./components/eye-catch/aspect-slot";
import * as ImageCropDialog from "./components/image-crop/crop-dialog";
import * as MfaEnrollment from "./components/mfa-enrollment";
import * as NotificationBell from "./components/notification-bell";
import * as PaginationFooter from "./components/pagination-controls";
import * as ProviderChoice from "./components/provider-choice";
import * as ProviderCredential from "./components/provider-credential";
import * as ProviderEnabled from "./components/provider-enabled";
import * as SecretKey from "./components/secret-key";
import * as Sortable from "./components/sortable-list";
import * as SubmitGate from "./components/submit-gate";

// `NotificationBell.Root` and `MfaEnrollment.Secret` read the tenant through
// `next/root-params`, a module only the Next.js compiler can provide, and
// nothing here renders a part.
vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("TENANT001"),
}));

const namespaces = {
  AnnouncementPinned,
  AppLinksPlatform,
  CreatorIcon,
  CredentialsEnabled,
  EntryList,
  EpisodePages,
  ErrorScreen,
  EyeCatchAspect,
  GoogleTagMode,
  ImageCropDialog,
  LegalPage,
  MfaEnrollSteps,
  MfaEnrollment,
  MfaSettingsOutcome,
  MfaVerifyMethods,
  MfaVerifySteps,
  NotificationBell,
  PageDraft,
  PaginationFooter,
  PasskeyAddition,
  PolicyOverride,
  ProviderChoice,
  ProviderCredential,
  ProviderEnabled,
  ReaderIconPolicySelection,
  RefundReason,
  RoyaltyCloseMode,
  SecretKey,
  SeriesCreatorCredits,
  SeriesEyeCatch,
  SeriesSchedule,
  SmtpOverride,
  SmtpPassword,
  SmtpTest,
  Sortable,
  SpreadStart,
  SubmitGate,
  ThemeSettings,
  TicketTarget,
};

describe("compound component namespaces", () => {
  // A part is renamed only where its module exports it, so React DevTools,
  // error overlays, and stack traces keep naming the component a part belongs
  // to instead of showing `Root` and `Trigger` for every tree in the console.
  it.each(Object.entries(namespaces))(
    "%s keeps each part's declared name",
    (namespace, parts) => {
      for (const [key, part] of Object.entries(parts)) {
        // A hook or a helper beside the parts may keep the name it is
        // declared with (`SubmitGate.useSetSubmittable`).
        if (typeof part === "function" && /^[A-Z]/u.test(key)) {
          expect(part.name, `${namespace}.${key}`).not.toBe(key);
        }
      }
    }
  );
});
