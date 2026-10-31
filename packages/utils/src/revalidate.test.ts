import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRevalidateRequest, REVALIDATE_TOKEN_ENV } from "./revalidate";

const { mockRevalidateTag } = vi.hoisted(() => ({
  mockRevalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

const TOKEN = "test-revalidate-token";

const revalidateRequest = (
  body: string,
  token: string | null = TOKEN
): Request => {
  const headers = new Headers({ "content-type": "application/json" });

  if (token !== null) {
    headers.set("x-revalidate-token", token);
  }

  return new Request("https://web.internal/api/v1/revalidate", {
    body,
    headers,
    method: "POST",
  });
};

describe("handleRevalidateRequest", () => {
  beforeEach(() => {
    mockRevalidateTag.mockReset();
    vi.stubEnv(REVALIDATE_TOKEN_ENV, TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("revalidates each distinct tag with the max profile", async () => {
    const response = await handleRevalidateRequest(
      revalidateRequest(JSON.stringify({ tags: ["a", " b ", "a"] }))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: 2, tags: ["a", "b"] });
    expect(mockRevalidateTag.mock.calls).toEqual([
      ["a", "max"],
      ["b", "max"],
    ]);
  });

  it.each([
    ["unset", ""],
    ["blank", "   "],
  ])("answers 500 when the token is %s", async (_label, value) => {
    vi.stubEnv(REVALIDATE_TOKEN_ENV, value);

    const response = await handleRevalidateRequest(
      revalidateRequest(JSON.stringify({ tags: ["a"] }), value)
    );

    expect(response.status).toBe(500);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["a wrong token", "wrong-token"],
    ["a token that only shares a prefix", `${TOKEN}-suffix`],
  ])("answers 401 for %s", async (_label, token) => {
    const response = await handleRevalidateRequest(
      revalidateRequest(JSON.stringify({ tags: ["a"] }), token)
    );

    expect(response.status).toBe(401);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("accepts a header token with surrounding whitespace", async () => {
    const response = await handleRevalidateRequest(
      revalidateRequest(JSON.stringify({ tags: ["a"] }), ` ${TOKEN} `)
    );

    expect(response.status).toBe(200);
  });

  it.each([
    ["a body that is not JSON", "not json", "invalid JSON"],
    ["no tags", JSON.stringify({ tags: [] }), "invalid payload"],
    ["a blank tag", JSON.stringify({ tags: ["  "] }), "invalid payload"],
    [
      "a tag over 256 characters",
      JSON.stringify({ tags: ["a".repeat(257)] }),
      "invalid payload",
    ],
    [
      "an unknown key",
      JSON.stringify({ tag: "a", tags: ["a"] }),
      "invalid payload",
    ],
  ])("answers 400 for %s", async (_label, body, error) => {
    const response = await handleRevalidateRequest(revalidateRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error });
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});
