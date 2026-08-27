import { beforeEach, describe, expect, it, vi } from "vitest";

import { revalidateTags } from "./revalidate";

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));

vi.mock("next/cache", () => ({ revalidateTag }));

const revalidateToken = "test-revalidate-token";

const request = (body: unknown, token = revalidateToken) =>
  new Request("https://web-host.example/api/v1/revalidate", {
    body: JSON.stringify(body),
    headers: { "x-revalidate-token": token },
    method: "POST",
  });

describe("revalidateTags", () => {
  beforeEach(() => {
    process.env.PUBLIRA_REVALIDATE_TOKEN = revalidateToken;
    revalidateTag.mockReset();
  });

  it("受け取ったタグを stale にする", async () => {
    const response = await revalidateTags(
      request({
        tags: ["tenant:tenant-a:site", "tenant:tenant-a:site"],
      })
    );

    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith(
      "tenant:tenant-a:site",
      "max"
    );
  });

  it("テナントをまたぐタグもそのまま再検証する", async () => {
    const response = await revalidateTags(
      request({
        tags: ["tenant:tenant-a:site", "tenant:tenant-b:series:list"],
      })
    );

    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenNthCalledWith(
      1,
      "tenant:tenant-a:site",
      "max"
    );
    expect(revalidateTag).toHaveBeenNthCalledWith(
      2,
      "tenant:tenant-b:series:list",
      "max"
    );
  });

  it("共有トークンを要求する", async () => {
    const response = await revalidateTags(
      request({ tags: ["tenant:tenant-a:site"] }, "wrong-token")
    );

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
