import { describe, expect, it, vi } from "vitest";

import { createForwardedForInterceptor } from "./forwarded-for";

const run = async (
  resolve: () => Promise<string | null | undefined>,
  header: Headers
) => {
  const next = vi.fn(() => Promise.resolve({ ok: true }));
  await createForwardedForInterceptor(resolve)(next as never)({
    header,
  } as never);
  expect(next).toHaveBeenCalledOnce();
};

describe("createForwardedForInterceptor", () => {
  it("forwards the edge's address on a call that carries a session", async () => {
    const header = new Headers({ Authorization: "Bearer session" });

    await run(() => Promise.resolve("203.0.113.7"), header);

    expect(header.get("X-Forwarded-For")).toBe("203.0.113.7");
  });

  it("does not read the request for a call without a session", async () => {
    const resolve = vi.fn(() => Promise.resolve("203.0.113.7"));
    const header = new Headers();

    await run(resolve, header);

    expect(resolve).not.toHaveBeenCalled();
    expect(header.has("X-Forwarded-For")).toBe(false);
  });

  it("keeps an address the call site set itself", async () => {
    const resolve = vi.fn(() => Promise.resolve("203.0.113.7"));
    const header = new Headers({
      Authorization: "Bearer session",
      "X-Forwarded-For": "198.51.100.4",
    });

    await run(resolve, header);

    expect(resolve).not.toHaveBeenCalled();
    expect(header.get("X-Forwarded-For")).toBe("198.51.100.4");
  });

  it("sets nothing when the request reached the app without the edge", async () => {
    const header = new Headers({ Authorization: "Bearer session" });

    await run(() => Promise.resolve(null), header);

    expect(header.has("X-Forwarded-For")).toBe(false);
  });
});
