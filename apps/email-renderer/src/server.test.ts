import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { EmailRendererService } from "@publira/api-client/email/renderer";
import { afterEach, describe, expect, it } from "vitest";

import { createEmailRendererServer, parsePort } from "./server";

const servers: ReturnType<typeof createEmailRendererServer>[] = [];

const startServer = async (): Promise<{
  baseUrl: string;
  server: ReturnType<typeof createEmailRendererServer>;
}> => {
  const server = createEmailRendererServer();
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => server[Symbol.asyncDispose]())
  );
});

describe("email renderer server", () => {
  it("テンプレートを件名、HTML、プレーンテキストに描画する", async () => {
    const { baseUrl } = await startServer();
    const client = createClient(
      EmailRendererService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" })
    );

    const response = await client.renderEmail({
      data: {
        action_label: "Open",
        action_url: "https://example.com",
        body: "Message body",
        title: "Example subject",
      },
      locale: "en",
      template: "sample",
      timeZone: "America/New_York",
    });

    expect(response.subject).toBe("Example subject");
    expect(response.html).toContain("Message body");
    expect(response.text).toContain("Message body");
  });

  it("不正なテンプレート入力を invalid_argument で返す", async () => {
    const { baseUrl } = await startServer();
    const client = createClient(
      EmailRendererService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" })
    );

    await expect(
      client.renderEmail({
        data: {},
        locale: "ja",
        template: "unknown",
        timeZone: "Asia/Tokyo",
      })
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("liveness と readiness を提供する", async () => {
    const { baseUrl } = await startServer();

    const livez = await fetch(`${baseUrl}/livez`);
    const readyz = await fetch(`${baseUrl}/readyz`);

    expect(livez.status).toBe(200);
    await expect(livez.text()).resolves.toBe("ok");
    expect(readyz.status).toBe(200);
    await expect(readyz.json()).resolves.toEqual({
      checks: {},
      status: "ok",
    });
  });
});

describe("parsePort", () => {
  it.each([
    [undefined, 8080],
    ["8081", 8081],
  ])("%s を %i として解釈する", (value, expected) => {
    expect(parsePort(value)).toBe(expected);
  });

  it.each(["0", "65536", "invalid"])("%s を拒否する", (value) => {
    expect(() => parsePort(value)).toThrow(
      "PORT must be an integer between 1 and 65535"
    );
  });
});
