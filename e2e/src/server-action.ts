import type { Page } from "@playwright/test";

/** The header Next.js puts on the POST that carries a Server Action. */
const SERVER_ACTION_HEADER = "next-action";

/**
 * The Server Action the next click submits, answered.
 *
 * A console form posts to the URL it sits on, and the browser drops that
 * request the moment a navigation starts: a `page.goto` or `page.reload` fired
 * straight after the click can cancel the write, or reach the screen it wants
 * to read before the write has committed. Most console writes say on screen
 * that they finished — a `role="status"` message, a success toast, a redirect —
 * and a spec should wait for that, because it is what the editor waits for.
 *
 * This is for the write that says nothing: an optimistic list rearranges itself
 * the moment the button is pressed, whether or not the Action behind it has
 * even been sent. Start waiting before the click, and await it before
 * navigating:
 *
 * ```ts
 * const reordered = serverActionAnswered(page);
 * await page.getByRole("button", { name: "Move X up" }).click();
 * await reordered;
 * ```
 */
export const serverActionAnswered = (page: Page): Promise<unknown> =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      SERVER_ACTION_HEADER in response.request().headers()
  );
