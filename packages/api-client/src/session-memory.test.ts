import { once } from "node:events";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, onTestFinished } from "vitest";

import { createAdminApiClient } from "./admin/client.js";

const UPLOAD_PATH = "/publira.admin.v1.AdminSeriesService/UploadEpisodeImages";

/** A trailers-only UNAUTHENTICATED, which is all a call here needs. */
const answer = (stream: http2.ServerHttp2Stream) => {
  stream.respond(
    {
      ":status": 200,
      "content-type": "application/grpc",
      "grpc-status": String(Code.Unauthenticated),
    },
    { endStream: true }
  );
};

/**
 * Answers every call at once, except the upload,
 * whose body it leaves unread until `release` is called. The client then holds
 * the rest of the body in its own session, as it does while a slow API is
 * still reading a large upload. `uploadHeld` settles once the server holds it.
 */
const startServer = async () => {
  const server = http2.createServer();
  const sessions: http2.ServerHttp2Session[] = [];
  const held: http2.ServerHttp2Stream[] = [];
  const uploadHeld = Promise.withResolvers<"held">();
  server.on("session", (session) => {
    sessions.push(session);
    session.on("stream", (stream, headers) => {
      if (headers[":path"] === UPLOAD_PATH) {
        stream.pause();
        held.push(stream);
        uploadHeld.resolve("held");

        return;
      }

      answer(stream);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const release = () => {
    for (const stream of held) {
      stream.resume();
      stream.on("end", () => {
        answer(stream);
      });
    }
  };

  const close = () => {
    for (const session of sessions) {
      session.destroy();
    }

    server.close();
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close,
    release,
    uploadHeld: uploadHeld.promise,
  };
};

const codeOf = async (call: Promise<unknown>) => {
  try {
    await call;

    return Code.Unknown;
  } catch (error) {
    return ConnectError.from(error).code;
  }
};

describe("the gRPC transport the Next.js apps use", () => {
  // Allocating 256 MiB and sending it is work a busy runner stretches well past
  // the default timeout, so this test is given its own.
  it("serves another call while a large upload is still being sent", async () => {
    const { baseUrl, close, release, uploadHeld } = await startServer();
    // Also when the test fails or times out, so the held upload and the
    // server do not outlive it.
    onTestFinished(close);
    const client = createAdminApiClient({ baseUrl, transport: "grpc" });

    // As large as the console lets an episode upload be.
    const upload = codeOf(
      client.series.uploadEpisodeImages({
        archiveData: new Uint8Array(256 * 1024 * 1024),
      })
    );

    // Waits for the server to hold the upload rather than for a fixed time,
    // which is however long the runner takes to allocate the body and start
    // sending it. An upload that settles first fails here, not on the timeout.
    expect(await Promise.race([uploadHeld, upload])).toBe("held");

    // A refused call is never answered, so the deadline turns it into a
    // failed assertion rather than the test's timeout.
    expect(await codeOf(client.auth.getMe({}, { timeoutMs: 2000 }))).toBe(
      Code.Unauthenticated
    );

    release();
    expect(await upload).toBe(Code.Unauthenticated);
  }, 30_000);
});
