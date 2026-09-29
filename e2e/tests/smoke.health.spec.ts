import { expect, test } from "@playwright/test";

/**
 * Health probes must not depend on tenant Host resolution.
 * Failures here usually mean the stack is not ready (or died mid-run).
 */
test.describe("web-host health probes", () => {
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

    const json = JSON.parse(trimmed) as { status?: string };
    expect(json.status).toBe("ok");
  });
});
