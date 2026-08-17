import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisIncrementalCacheHandler } from "./incremental-cache-handler";
import { getRedisClient, resetRedisClientsForTests } from "./redis-client";
import { streamToBuffer } from "./serialize";
import { createUseCacheHandler } from "./use-cache-handler";

const redisUrl =
  process.env.PUBLIRA_REDIS_URL?.trim() || "redis://localhost:6379";
const keyPrefix = `publira:test-${process.pid}:`;

const canConnect = async (): Promise<boolean> => {
  resetRedisClientsForTests();
  process.env.PUBLIRA_REDIS_URL = redisUrl;
  delete process.env.NEXT_PHASE;
  const client = await getRedisClient({
    defaultTtlSeconds: 60,
    keyPrefix,
    maxTtlSeconds: 3600,
    redisUrl,
    timeoutMs: 1000,
  });
  return Boolean(client?.isReady);
};

describe("Redis handlers integration", () => {
  let available = false;

  beforeAll(async () => {
    available = await canConnect();
  });

  afterAll(async () => {
    if (!available) {
      return;
    }
    const client = await getRedisClient({
      defaultTtlSeconds: 60,
      keyPrefix,
      maxTtlSeconds: 3600,
      redisUrl,
      timeoutMs: 1000,
    });
    if (!client) {
      return;
    }
    const keys = await client.keys(`${keyPrefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
    }
    resetRedisClientsForTests();
  });

  it("use-cache handler set/get and tag invalidation", async ({ skip }) => {
    if (!available) {
      skip();
    }

    const handler = createUseCacheHandler({ keyPrefix, redisUrl });
    const cacheKey = "uc-key-1";
    const payload = new TextEncoder().encode("hello-cache");

    await handler.set(
      cacheKey,
      Promise.resolve({
        expire: 3600,
        revalidate: 60,
        stale: 30,
        tags: ["tenant:t1:pages"],
        timestamp: Date.now(),
        value: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(payload);
            controller.close();
          },
        }),
      })
    );

    const hit = await handler.get(cacheKey, []);
    expect(hit).toBeDefined();
    if (!hit) {
      throw new Error("expected cache hit");
    }
    const body = await streamToBuffer(hit.value);
    expect(new TextDecoder().decode(body)).toBe("hello-cache");

    await handler.updateTags(["tenant:t1:pages"]);
    await handler.refreshTags();
    const missed = await handler.get(cacheKey, []);
    expect(missed).toBeUndefined();
  });

  it("incremental handler set/get IMAGE and revalidateTag", async ({
    skip,
  }) => {
    if (!available) {
      skip();
    }

    const handler = new RedisIncrementalCacheHandler(
      { _requestHeaders: {}, revalidatedTags: [] },
      { keyPrefix, redisUrl }
    );

    const key = "img-key-1";
    await handler.set(
      key,
      {
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        etag: "e1",
        extension: "jpg",
        kind: "IMAGE",
        revalidate: 120,
        upstreamEtag: "u1",
      },
      { tags: ["tenant:t1:image"] }
    );

    const hit = await handler.get(key, { kind: "IMAGE" });
    expect(hit).not.toBeNull();
    if (!hit) {
      throw new Error("expected image cache hit");
    }
    const value = hit.value as {
      buffer: Buffer;
      etag: string;
      kind: string;
    };
    expect(value.kind).toBe("IMAGE");
    expect(Buffer.isBuffer(value.buffer)).toBe(true);
    expect(value.buffer.equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(value.etag).toBe("e1");

    await handler.revalidateTag("tenant:t1:image");
    const missed = await handler.get(key, { kind: "IMAGE" });
    expect(missed).toBeNull();
  });
});
