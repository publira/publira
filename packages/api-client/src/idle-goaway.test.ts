import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { once } from "node:events";
import * as http2 from "node:http2";
import type { AddressInfo, Socket } from "node:net";
import { setImmediate } from "node:timers/promises";

import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdminApiClient } from "./admin/client.js";

/**
 * Answers every call with a trailers-only UNAUTHENTICATED, which is enough to
 * open a connection and leave it idle once the call has finished.
 */
const startServer = async () => {
  const server = http2.createServer();
  const sessions: http2.ServerHttp2Session[] = [];
  server.on("session", (session) => {
    sessions.push(session);
  });
  server.on("stream", (stream) => {
    stream.respond(
      {
        ":status": 200,
        "content-type": "application/grpc",
        "grpc-status": String(Code.Unauthenticated),
      },
      { endStream: true }
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server, sessions };
};

/** Settles once the socket has closed, including when it closed with an error. */
const closeOf = async (socket: Socket) => {
  try {
    await once(socket, "close");
  } catch {
    // `once` rejects on the "error" the socket emits right before "close".
  }
};

const getMe = async (client: ReturnType<typeof createAdminApiClient>) => {
  try {
    await client.auth.getMe({});
    return Code.Unknown;
  } catch (error) {
    return ConnectError.from(error).code;
  }
};

describe("the gRPC transport the Next.js apps use", () => {
  let uncaught: unknown[];
  const onUncaught = (error: unknown) => {
    uncaught.push(error);
  };
  let sockets: Socket[];
  const onSocket = (message: unknown) => {
    sockets.push((message as { socket: Socket }).socket);
  };

  beforeEach(() => {
    uncaught = [];
    sockets = [];
    process.prependListener("uncaughtException", onUncaught);
    subscribe("net.client.socket", onSocket);
  });

  afterEach(() => {
    process.off("uncaughtException", onUncaught);
    unsubscribe("net.client.socket", onSocket);
  });

  it("raises no uncaught exception when the API sends GOAWAY to an idle connection", async () => {
    const { baseUrl, server, sessions } = await startServer();
    const client = createAdminApiClient({ baseUrl, transport: "grpc" });

    expect(await getMe(client)).toBe(Code.Unauthenticated);
    const [idle] = sessions;
    const [socket] = sockets;

    // Listening before the GOAWAY puts this listener ahead of the one that
    // raises the error, so an uncaught one cannot keep it from settling.
    const closed = closeOf(socket);

    // The client answers the GOAWAY by destroying its session and ending the
    // socket, but raises the error it destroyed the session with only once the
    // socket has closed. The next call reconnects in between.
    idle.goaway(http2.constants.NGHTTP2_NO_ERROR);
    await once(socket, "finish");
    expect(await getMe(client)).toBe(Code.Unauthenticated);

    await closed;
    await setImmediate();

    for (const session of sessions) {
      session.destroy();
    }
    server.close();

    expect(uncaught).toEqual([]);
  });
});
