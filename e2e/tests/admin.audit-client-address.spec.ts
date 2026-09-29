import { expect, test } from "@playwright/test";

import { createGenreViaUi, signInAsAdmin } from "../src/admin";
import { deleteGenresByNames, querySql, quoteSqlLiteral } from "../src/db";
import { SEED_ADMIN, uniqueSuffix } from "../src/scenarios/admin-publish";

/**
 * The E2E edge listens on loopback, so loopback is the address it names in
 * `X-Forwarded-For` for the browser.
 */
const EDGE_CLIENT_ADDRESS = "127.0.0.1";

const auditedClientAddress = (genreName: string): string =>
  querySql(`
    SELECT COALESCE(a.client_ip, '')
    FROM audit_logs a
    JOIN genres g ON g.public_id = a.target_id
    WHERE a.action = 'genre_created' AND g.name = ${quoteSqlLiteral(genreName)};
  `);

test.describe("console audit log client address", () => {
  const genreName = `E2E Audit Address ${uniqueSuffix()}`;

  test.afterAll(() => {
    deleteGenresByNames([genreName]);
  });

  test("records the operator's address the edge named for a console action", async ({
    page,
  }) => {
    await signInAsAdmin(page, SEED_ADMIN, "/genres");
    await createGenreViaUi(page, genreName);

    await expect
      .poll(() => auditedClientAddress(genreName), { timeout: 15_000 })
      .toBe(EDGE_CLIENT_ADDRESS);
  });
});
