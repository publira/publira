import { once } from "node:events";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { setImmediate } from "node:timers/promises";

import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { GRPC_IDLE_CONNECTION_TIMEOUT_MS } from "./grpc-session.js";
import { createPublicApiClient } from "./public/client.js";

/** A trailers-only NOT_FOUND, which tells a served call from a refused one. */
const answer = (stream: http2.ServerHttp2Stream) => {
  stream.respond(
    {
      ":status": 200,
      "content-type": "application/grpc",
      "grpc-status": String(Code.NotFound),
    },
    { endStream: true }
  );
};

/**
 * The two ways an HTTP/2 server refuses a stream before reading it: an
 * RST_STREAM naming `REFUSED_STREAM`, and the GOAWAY a server sends when it
 * closes the connection (idle, or shutting down) whose last stream precedes
 * one the client has just opened.
 */
const refusals = {
  goaway: (stream: http2.ServerHttp2Stream) => {
    // Client streams take odd IDs in order, so this names the one before.
    const lastStreamID = (stream.id ?? 1) - 2;
    stream.session?.goaway(http2.constants.NGHTTP2_NO_ERROR, lastStreamID);
  },
  rstStream: (stream: http2.ServerHttp2Stream) => {
    stream.close(http2.constants.NGHTTP2_REFUSED_STREAM);
  },
} as const;

/**
 * Hands every stream to `handle`, which answers it or refuses it, and counts
 * the streams it was handed.
 */
const startServer = async (
  handle: (stream: http2.ServerHttp2Stream, index: number) => void
) => {
  const server = http2.createServer();
  const sessions: http2.ServerHttp2Session[] = [];
  let streams = 0;
  server.on("session", (session) => {
    sessions.push(session);
  });
  server.on("stream", (stream) => {
    // The server side of a refused stream errors too.
    stream.on("error", () => {
      // Nothing to report: the client side is what the tests assert.
    });
    handle(stream, streams);
    streams += 1;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  onTestFinished(() => {
    for (const session of sessions) {
      session.destroy();
    }
    server.close();
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    sessions,
    streams: () => streams,
  };
};

const getTenant = async (client: ReturnType<typeof createPublicApiClient>) => {
  try {
    await client.tenant.getTenant({});
    return { code: Code.Unknown, message: "" };
  } catch (error) {
    const { code, rawMessage } = ConnectError.from(error);
    return { code, message: rawMessage };
  }
};

describe("the gRPC transport the Next.js apps use", () => {
  for (const [name, refuse] of Object.entries(refusals)) {
    it(`sends a call the API refused with ${name} once more, and is answered`, async () => {
      const { baseUrl, streams } = await startServer((stream, index) => {
        if (index === 1) {
          refuse(stream);
          return;
        }
        answer(stream);
      });
      const client = createPublicApiClient({ baseUrl, transport: "grpc" });

      expect(await getTenant(client)).toMatchObject({ code: Code.NotFound });
      expect(await getTenant(client)).toMatchObject({ code: Code.NotFound });
      expect(streams()).toBe(3);
    });
  }

  it("gives up on a call the API refuses twice", async () => {
    const { baseUrl, streams } = await startServer(refusals.rstStream);
    const client = createPublicApiClient({ baseUrl, transport: "grpc" });

    expect(await getTenant(client)).toEqual({
      code: Code.Internal,
      message: "Stream closed with error code NGHTTP2_REFUSED_STREAM",
    });
    expect(streams()).toBe(2);
  });

  it("does not send again a call whose stream the API reset for another reason", async () => {
    const { baseUrl, streams } = await startServer((stream) => {
      stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
    });
    const client = createPublicApiClient({ baseUrl, transport: "grpc" });

    expect(await getTenant(client)).toEqual({
      code: Code.Internal,
      message: "Stream closed with error code NGHTTP2_INTERNAL_ERROR",
    });
    expect(streams()).toBe(1);
  });

  it("closes an idle session before the API's 120-second idle timeout would", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { baseUrl, sessions } = await startServer(answer);
    const client = createPublicApiClient({ baseUrl, transport: "grpc" });

    expect(await getTenant(client)).toMatchObject({ code: Code.NotFound });
    const [session] = sessions;
    const closed = once(session, "close");

    // The session starts counting once the call's stream has closed, which
    // happens after the call has resolved.
    await setImmediate();
    vi.advanceTimersByTime(GRPC_IDLE_CONNECTION_TIMEOUT_MS);
    await closed;
    expect(GRPC_IDLE_CONNECTION_TIMEOUT_MS).toBeLessThan(120_000);
  });
});
