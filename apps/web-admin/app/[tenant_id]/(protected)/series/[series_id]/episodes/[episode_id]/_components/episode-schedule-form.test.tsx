// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeScheduleForm } from "./episode-schedule-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("@publira/ui-components/button", () => ({
  Button: (props: React.ComponentProps<"button">) => (
    <button {...props} type="button" />
  ),
}));

vi.mock("@publira/ui-components/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock("@publira/ui-components/field", () => ({
  Field: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FieldContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FieldDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  FieldLabel: ({
    children,
    htmlFor,
  }: {
    children: React.ReactNode;
    htmlFor?: string;
  }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock("@publira/ui-components/form-message", () => ({
  FormMessage: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

vi.mock("@publira/ui-components/input", () => ({
  Input: (props: React.ComponentPropsWithRef<"input">) => <input {...props} />,
}));

afterEach(() => {
  cleanup();
});

describe("EpisodeScheduleForm", () => {
  const action = vi.fn(() => Promise.resolve(null));

  it("scheduledAt をテナントタイムゾーンの壁時計として初期表示する", () => {
    const { container } = render(
      <EpisodeScheduleForm
        action={action}
        episodePublicId="EP001"
        scheduledAt="2030-01-01T01:00:00Z"
        seriesPublicId="SERIES001"
        timeZone="Asia/Tokyo"
      />
    );

    const localInput = container.querySelector(
      "#episode_edit_publish_at"
    ) as HTMLInputElement | null;

    expect(localInput?.value).toBe("2030-01-01T10:00");
  });

  it("予約が無いときは入力を空にする", () => {
    const { container } = render(
      <EpisodeScheduleForm
        action={action}
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
        timeZone="Asia/Tokyo"
      />
    );

    const localInput = container.querySelector(
      "#episode_edit_publish_at"
    ) as HTMLInputElement | null;

    expect(localInput?.value).toBe("");
  });
});
