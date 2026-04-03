// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormMessage } from "./form-message";

describe("FormMessage", () => {
  it("デフォルトで status role と info アイコンを表示する", () => {
    render(<FormMessage>保存しました</FormMessage>);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("保存しました")).toBeTruthy();
    expect(screen.getByText("i")).toBeTruthy();
  });

  it("success variant のアイコンを表示する", () => {
    render(<FormMessage variant="success">成功</FormMessage>);

    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("成功")).toBeTruthy();
  });
});
