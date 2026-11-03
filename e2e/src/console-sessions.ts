import type { Browser, Cookie, Page } from "@playwright/test";
import { test as base } from "@playwright/test";

import { fillLoginForm } from "./session";

/** The email address and the password an account signs in to a console with. */
interface Credentials {
  email: string;
  password: string;
}

export interface ConsoleSessions {
  /**
   * Start `page`'s context signed in as `credentials` on the console at
   * `baseUrl`, without opening a page: the next navigation is the screen.
   */
  signIn: (
    page: Page,
    credentials: Credentials,
    baseUrl: string
  ) => Promise<void>;
}

/**
 * Sign in on a context of its own and keep the cookies the console set.
 *
 * The context is thrown away once they are read, so the screen the console
 * redirects to after signing in is rendered in no context a test photographs.
 */
const signInFresh = async (
  browser: Browser,
  credentials: Credentials,
  baseUrl: string
): Promise<Cookie[]> => {
  const context = await browser.newContext();

  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await fillLoginForm(page, credentials);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));

    return await context.cookies();
  } finally {
    await context.close();
  }
};

/**
 * `test` with {@link ConsoleSessions}: each account signs in once per worker,
 * and every later test starts from the cookies that sign-in left.
 *
 * For the screenshot suites, which photograph a signed-in screen rather than
 * test signing in: a test that signs in through the form spends three
 * navigations and a sign-in RPC where the screen needs one navigation. The
 * cookies hold the session the API issued, which outlasts the run. The
 * locale cookie is set after this, per test, as `setDocsLocale` says.
 */
export const test = base.extend<
  Record<never, never>,
  { consoleSessions: ConsoleSessions }
>({
  consoleSessions: [
    async ({ browser }, use) => {
      const sessions = new Map<string, Cookie[]>();

      await use({
        signIn: async (page, credentials, baseUrl) => {
          const key = `${baseUrl} ${credentials.email}`;
          let cookies = sessions.get(key);

          if (cookies === undefined) {
            cookies = await signInFresh(browser, credentials, baseUrl);
            sessions.set(key, cookies);
          }

          await page.context().addCookies(cookies);
        },
      });
    },
    { scope: "worker" },
  ],
});
