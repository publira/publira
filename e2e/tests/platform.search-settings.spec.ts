import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  restorePlatformSettingsRow,
  runSql,
  snapshotPlatformSettingsRow,
} from "../src/db";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import {
  platformSearchSettingsTag,
  revalidatePlatformTags,
} from "../src/revalidate";
import { SEED_TENANT_ID } from "../src/scenarios/auth";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { PUBLIC_API_BASE_URL } from "../src/urls";

const SEARCH_PATH = "/services/search";

/**
 * Which engine `scripts/db-setup.sh` saved: OpenSearch under
 * `task e2e:search`, nothing — the SQL engine — in every other run.
 */
const onOpenSearch = process.env.PUBLIRA_E2E_SEARCH_BACKEND === "opensearch";
const OPENSEARCH_URL = process.env.PUBLIRA_E2E_OPENSEARCH_URL ?? "";

/**
 * A port nothing in the stack listens on: the discard service, which needs a
 * privileged bind no process here makes. A connection to it is refused at
 * once, so an engine there fails its test and its build without a timeout.
 */
const UNREACHABLE_URL = "http://127.0.0.1:9";

const SAVED_MESSAGE = "Search settings saved.";
const SAVED_BUILDING_MESSAGE =
  "Search settings saved. The index is being built now, and the search moves to the new engine once it's ready.";

/**
 * The build waits for the worker's next pass, and the server moves onto a
 * built index on its own next read of the settings. Each comes every 30
 * seconds.
 */
const SWITCH_TIMEOUT = 120_000;

/**
 * A query only an engine with fuzzy matching answers: the seeded series' title
 * with one wrong character. The SQL engine matches the title as written, so
 * the seeded series is in the answer exactly while OpenSearch is answering.
 */
const FUZZY_QUERY = SEED_TENANT.series.title.replace("Seed", "Sead");

const openSearchSettings = async (page: Page): Promise<void> => {
  await signInAsSeedPlatformSuperAdmin(page, SEARCH_PATH);
  await expect(
    page.getByRole("heading", { name: "Search engine" })
  ).toBeVisible();
};

/** The value the status section gives a label, such as "Answering from". */
const statusValue = (page: Page, label: string) =>
  page
    .locator("dt", { hasText: label })
    .locator("xpath=following-sibling::dd[1]");

const chooseEngine = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("radio", { exact: true, name }).click();
};

const save = async (page: Page, message: string): Promise<void> => {
  await page.getByRole("button", { name: "Save search settings" }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
};

/** Ask the public API whether the fuzzy query finds the seeded series. */
const fuzzyQueryFindsSeedSeries = async (): Promise<boolean> => {
  const response = await fetch(
    `${PUBLIC_API_BASE_URL}/publira.v1.CatalogService/SearchPublishedSeries`,
    {
      body: JSON.stringify({
        limit: 20,
        query: FUZZY_QUERY,
        surface: "CLIENT_SURFACE_WEB",
        tenant: { tenantId: SEED_TENANT_ID },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
  expect(response.ok, await response.clone().text()).toBe(true);
  const { series = [] } = (await response.json()) as {
    series?: { publicId: string }[];
  };
  return series.some((item) => item.publicId === SEED_TENANT.series.publicId);
};

/** The alias `scripts/db-setup.sh` saves, which the server defaults to. */
const OPENSEARCH_ALIAS = "publira-catalog";

/**
 * A definition built on analysis-nori, which the E2E engine has installed
 * beside the default's plugins: Korean has no alternate form, so that role
 * analyzes the text the way the written form does.
 */
const NORI_DEFINITION = JSON.stringify(
  {
    analyzer: {
      alternate_form: {
        filter: ["nori_part_of_speech", "lowercase"],
        tokenizer: "nori_tokenizer",
        type: "custom",
      },
      written_form: {
        filter: ["nori_part_of_speech", "lowercase"],
        tokenizer: "nori_tokenizer",
        type: "custom",
      },
    },
    normalizer: { exact_match: { filter: ["lowercase"], type: "custom" } },
  },
  null,
  2
);

/** A definition every role of which is there, on a tokenizer no engine has. */
const UNKNOWN_TOKENIZER_DEFINITION = NORI_DEFINITION.replaceAll(
  "nori_tokenizer",
  "no_such_tokenizer"
);

/**
 * The words the index the alias names makes of a Korean title in the written
 * form. The default definition keeps 「별을」 whole; one built on analysis-nori
 * takes the particle off, which is how a query of 「별」 finds the title.
 */
const writtenFormTokens = async (): Promise<string[]> => {
  const response = await fetch(
    `${OPENSEARCH_URL}/${OPENSEARCH_ALIAS}/_analyze`,
    {
      body: JSON.stringify({
        analyzer: "written_form",
        text: "별을 쫓는 아이",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
  expect(response.ok, await response.clone().text()).toBe(true);
  const { tokens = [] } = (await response.json()) as {
    tokens?: { token: string }[];
  };
  return tokens.map((item) => item.token);
};

const expectOpenSearchAnswering = async (answering: boolean): Promise<void> => {
  await expect
    .poll(fuzzyQueryFindsSeedSeries, {
      message: `the public search never ${answering ? "moved onto" : "left"} OpenSearch`,
      timeout: SWITCH_TIMEOUT,
    })
    .toBe(answering);
};

/**
 * The Platform Console's catalog search settings: the engine every tenant's
 * storefront searches with, and the switch from one to another.
 *
 * The row is one for the whole installation, which is why this suite has a
 * project of its own after the catalog search suite. Under `task e2e:search`
 * it moves the stack from OpenSearch to PostgreSQL and back; in every other
 * run there is no engine to move to, so it shows a build that cannot reach
 * one, which leaves the search on PostgreSQL throughout.
 */
test.describe("web-platform search settings", () => {
  test.describe.configure({ mode: "serial" });

  let snapshot = "";

  test.beforeAll(() => {
    snapshot = snapshotPlatformSettingsRow("platform_search_config");
  });

  test.afterAll(async () => {
    if (snapshot) {
      restorePlatformSettingsRow("platform_search_config", snapshot);
    } else {
      runSql(`DELETE FROM platform_search_config;`);
    }
    await revalidatePlatformTags([platformSearchSettingsTag]);
  });

  if (onOpenSearch) {
    test("a connection test reports the engine's version and both plugins", async ({
      page,
    }) => {
      await openSearchSettings(page);
      await expect(
        page.getByRole("radio", { name: "OpenSearch" })
      ).toBeChecked();

      await page.getByRole("button", { name: "Test connection" }).click();

      await expect(
        page.getByText(
          "The connection works, and the engine has both plugins the catalog index needs."
        )
      ).toBeVisible();
      await expect(
        page
          .getByRole("list", { name: "Connection test results" })
          .getByRole("listitem")
      ).toHaveText([
        /^Engine: OpenSearch \d/u,
        "analysis-kuromoji: Installed",
        "analysis-icu: Installed",
      ]);
    });

    test("the search moves to PostgreSQL and back to OpenSearch from this page alone", async ({
      page,
    }) => {
      test.setTimeout(SWITCH_TIMEOUT * 3);

      await openSearchSettings(page);
      await expect(statusValue(page, "Answering from")).toHaveText(
        "OpenSearch"
      );
      await expectOpenSearchAnswering(true);

      // PostgreSQL keeps no index, so the search moves at once.
      await chooseEngine(page, "PostgreSQL");
      await save(page, SAVED_MESSAGE);
      await expect(statusValue(page, "Answering from")).toHaveText(
        "PostgreSQL"
      );
      await expectOpenSearchAnswering(false);

      // Back onto OpenSearch: the index is rebuilt from the database first,
      // and PostgreSQL answers until it is ready.
      await chooseEngine(page, "OpenSearch");
      await page.getByRole("textbox", { name: /^URL/u }).fill(OPENSEARCH_URL);
      await save(page, SAVED_BUILDING_MESSAGE);
      await expect(
        page.getByText(/The OpenSearch index is being built/u)
      ).toBeVisible();
      await expect(statusValue(page, "Answering from")).toHaveText(
        "PostgreSQL"
      );

      // The page asks again on its own while the build runs.
      await expect(statusValue(page, "Answering from")).toHaveText(
        "OpenSearch",
        { timeout: SWITCH_TIMEOUT }
      );
      await expect(
        page.getByText(/The OpenSearch index is being built/u)
      ).toHaveCount(0);
      await expectOpenSearchAnswering(true);
    });

    test("the text analysis is replaced with one on analysis-nori and reset to the default from this page alone", async ({
      page,
    }) => {
      test.setTimeout(SWITCH_TIMEOUT * 3);

      await openSearchSettings(page);
      const editor = page.getByRole("textbox", { name: /^Definition/u });
      await expect(
        page.getByText("In use: the default definition.")
      ).toBeVisible();
      await expect(editor).toHaveValue(/"kuromoji_tokenizer"/u);
      await expect.poll(writtenFormTokens).toContain("별을");

      // A definition the engine refuses is not saved, and stays in the editor
      // with the engine's reason beside it.
      await editor.fill(UNKNOWN_TOKENIZER_DEFINITION);
      await page.getByRole("button", { name: "Save text analysis" }).click();
      await expect(
        page.getByText("The definition wasn't saved. Fix it and save again.")
      ).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: /no_such_tokenizer/u })
      ).toBeVisible();
      await expect(editor).toHaveValue(UNKNOWN_TOKENIZER_DEFINITION);
      await expect(
        page.getByText("In use: the default definition.")
      ).toBeVisible();

      // A definition on analysis-nori is built into a new index while the
      // current one keeps answering, and the alias moves onto it.
      await editor.fill(NORI_DEFINITION);
      await page.getByRole("button", { name: "Save text analysis" }).click();
      await expect(
        page.getByText(
          "Text analysis saved. A new index is being built with it, and the search moves onto it once it's ready."
        )
      ).toBeVisible();
      await expect(
        page.getByText(/^A new OpenSearch index is being built/u)
      ).toBeVisible();
      // The current index keeps answering, so the new definition is saved
      // but not in use until the build is done.
      await expect(
        page.getByText(/^Saved: a definition of your own\./u)
      ).toBeVisible();
      await expect(editor).toHaveValue(/"nori_tokenizer"/u);

      // The page asks again on its own while the build runs.
      await expect(
        page.getByText(/^A new OpenSearch index is being built/u)
      ).toHaveCount(0, { timeout: SWITCH_TIMEOUT });
      await expect(page.getByText("In use: a saved definition.")).toBeVisible();
      await expect(statusValue(page, "Answering from")).toHaveText(
        "OpenSearch"
      );
      await expect.poll(writtenFormTokens).toContain("별");
      await expectOpenSearchAnswering(true);

      // Going back to the default is confirmed first, since it is a rebuild
      // as well.
      await page.getByRole("button", { name: "Reset to default" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Reset and rebuild" }).click();
      await expect(
        page.getByText(/^Text analysis saved\. A new index is being built/u)
      ).toBeVisible();
      await expect(
        page.getByText(/^Saved: the default definition\./u)
      ).toBeVisible();
      await expect(editor).toHaveValue(/"kuromoji_tokenizer"/u);

      await expect(
        page.getByText(/^A new OpenSearch index is being built/u)
      ).toHaveCount(0, { timeout: SWITCH_TIMEOUT });
      await expect(
        page.getByText("In use: the default definition.")
      ).toBeVisible();
      await expect.poll(writtenFormTokens).toContain("별을");
      await expectOpenSearchAnswering(true);
    });
    return;
  }

  test("a platform that saved no engine searches with PostgreSQL", async ({
    page,
  }) => {
    await openSearchSettings(page);

    await expect(statusValue(page, "Answering from")).toHaveText("PostgreSQL");
    await expect(page.getByRole("radio", { name: "PostgreSQL" })).toBeChecked();
    await expect(page.getByRole("textbox", { name: /^URL/u })).toHaveCount(0);
  });

  test("a connection test names an engine it cannot reach", async ({
    page,
  }) => {
    await openSearchSettings(page);
    await chooseEngine(page, "OpenSearch");
    await page.getByRole("textbox", { name: /^URL/u }).fill(UNREACHABLE_URL);

    await page.getByRole("button", { name: "Test connection" }).click();

    await expect(page.getByText(/^Connection failed/u)).toBeVisible();
  });

  test("a build that fails leaves the search on PostgreSQL and says so, until PostgreSQL is saved again", async ({
    page,
  }) => {
    test.setTimeout(SWITCH_TIMEOUT * 2);

    await openSearchSettings(page);
    await chooseEngine(page, "OpenSearch");
    await page.getByRole("textbox", { name: /^URL/u }).fill(UNREACHABLE_URL);
    await save(page, SAVED_BUILDING_MESSAGE);
    await expect(
      page.getByText(/The OpenSearch index is being built/u)
    ).toBeVisible();

    // The page asks again on its own while the build runs.
    await expect(
      page.getByText(/The OpenSearch index couldn't be built/u)
    ).toBeVisible({ timeout: SWITCH_TIMEOUT });
    await expect(statusValue(page, "Answering from")).toHaveText("PostgreSQL");

    await chooseEngine(page, "PostgreSQL");
    await save(page, SAVED_MESSAGE);
    await expect(
      page.getByText(/The OpenSearch index couldn't be built/u)
    ).toHaveCount(0);
    await expect(statusValue(page, "Answering from")).toHaveText("PostgreSQL");
  });
});
