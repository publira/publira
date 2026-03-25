import "./globals.css";
import {
  SiteLayout,
  SiteLayoutActions,
  getAuthActions,
} from "@publira/layouts";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { PUBLIC_SESSION_COOKIE_NAME } from "../lib/auth";

const HeaderActionsFallback = () => {
  const { primaryAction, secondaryAction } = getAuthActions(false);

  return (
    <SiteLayoutActions
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    />
  );
};

const DynamicHeaderActions = async () => {
  const cookieStore = await cookies();
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
  const actions = getAuthActions(hasSession);

  return (
    <SiteLayoutActions
      primaryAction={actions.primaryAction}
      secondaryAction={actions.secondaryAction}
    />
  );
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>
        <SiteLayout
          appLabel="Publira"
          actions={
            <Suspense fallback={<HeaderActionsFallback />}>
              <DynamicHeaderActions />
            </Suspense>
          }
        >
          {children}
        </SiteLayout>
      </body>
    </html>
  );
}
