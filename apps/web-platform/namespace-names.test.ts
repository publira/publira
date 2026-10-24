// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import * as MfaSettingsOutcome from "./app/(protected)/account/_components/mfa-settings-outcome";
import * as SmtpPassword from "./app/(protected)/services/email/_components/smtp-password";
import * as SmtpTest from "./app/(protected)/services/email/_components/smtp-test";
import * as TenantMemberRemovals from "./app/(protected)/tenants/[tenant_id]/members/_components/tenant-member-removals";
import * as TenantMemberRoleDialog from "./app/(protected)/tenants/[tenant_id]/members/_components/tenant-member-role-dialog";
import * as MfaEnrollSteps from "./app/mfa/_components/mfa-enroll-steps";
import * as MfaVerifySteps from "./app/mfa/_components/mfa-verify-steps";
import * as DangerConfirmButton from "./components/danger-confirm-button";
import * as ErrorScreen from "./components/error-screen";
import * as MfaEnrollment from "./components/mfa-enrollment";
import * as NotificationBell from "./components/notification-bell";

const namespaces = {
  DangerConfirmButton,
  ErrorScreen,
  MfaEnrollSteps,
  MfaEnrollment,
  MfaSettingsOutcome,
  MfaVerifySteps,
  NotificationBell,
  SmtpPassword,
  SmtpTest,
  TenantMemberRemovals,
  TenantMemberRoleDialog,
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
