import type { Page } from "@playwright/test";

import { PAIDY_BASE_URL } from "./urls";

/** Where the storefront's payment page loads Paidy Checkout from. */
const PAIDY_SCRIPT_URL = "https://apps.paidy.com/";

/**
 * Serve the page the Paidy stand-in's fake of Paidy Checkout wherever it asks
 * for Paidy's own script, so no request of the run reaches Paidy.
 */
export const routePaidyCheckout = async (page: Page): Promise<void> => {
  const response = await fetch(`${PAIDY_BASE_URL}/paidy.js`);

  if (!response.ok) {
    throw new Error(
      `the Paidy stand-in did not serve its script: ${response.status}`
    );
  }

  const body = await response.text();

  await page.route(PAIDY_SCRIPT_URL, (route) =>
    route.fulfill({ body, contentType: "text/javascript", status: 200 })
  );
};
