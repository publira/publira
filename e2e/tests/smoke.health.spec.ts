import { expect, test } from "@playwright/test";

/** The JSON `/readyz` answers. */
interface Readiness {
  status?: string;
}

/**
 * Health probes must not depend on tenant Host resolution.
 * Failures here usually mean the stack is not ready (or died mid-run).
 */
test.describe("web-storefront health probes", () => {
  test("GET /livez returns plain ok", async ({ request }) => {
    const response = await request.get("/livez");
    const body = await response.text();
    expect(response.status(), body).toBe(200);
    expect(body.trim()).toBe("ok");
  });

  test("GET /readyz reports ok", async ({ request }) => {
    const response = await request.get("/readyz");
    const body = await response.text();
    const trimmed = body.trim();
    expect(response.status(), trimmed).toBe(200);

    // SAFETY: the JSON web-storefront's `/readyz` Route Handler answers.
    const json = JSON.parse(trimmed) as Readiness;
    expect(json.status).toBe("ok");
  });
});
