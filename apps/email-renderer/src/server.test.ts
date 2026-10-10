import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { EmailRendererService } from "@publira/api-client/email/renderer";
import { describe, expect, it } from "vitest";

import { createEmailRendererServer, parsePort } from "./server.ts";

const startServer = async (): Promise<Server> => {
  const server = createEmailRendererServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
};

const baseUrlOf = (server: Server): string => {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

describe("email renderer server", () => {
  it("renders a template into HTML", async () => {
    await using server = await startServer();
    const baseUrl = baseUrlOf(server);
    const client = createClient(
      EmailRendererService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" })
    );

    const response = await client.renderEmail({
      data: {
        expires_at: "2030-01-15T12:00:00Z",
        reset_url: "https://reader.example.test/confirm-password?token=reset",
        tenant_name: "Aoto Press",
      },
      locale: "en",
      template: "reader_password_reset",
      timeZone: "America/New_York",
    });

    expect(response.html).toContain("Reset your password");
    expect(response.html).toContain(
      "https://reader.example.test/confirm-password?token=reset"
    );
  });

  it("invalid template input comes back as invalid_argument", async () => {
    await using server = await startServer();
    const baseUrl = baseUrlOf(server);
    const client = createClient(
      EmailRendererService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" })
    );

    await expect(
      client.renderEmail({
        data: {},
        locale: "ja",
        template: "unknown",
        timeZone: "UTC",
      })
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("serves liveness and readiness", async () => {
    await using server = await startServer();
    const baseUrl = baseUrlOf(server);

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
  ])("parses %s as %i", (value, expected) => {
    expect(parsePort(value)).toBe(expected);
  });

  it.each(["0", "65536", "invalid"])("rejects %s", (value) => {
    expect(() => parsePort(value)).toThrow(
      "PORT must be an integer between 1 and 65535"
    );
  });
});
