// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useActionState } from "react";
import { describe, expect, it } from "vitest";

import { FormMessage } from "./form-message";

const ActionForm = () => {
  const [count, formAction] = useActionState(
    (previous: number) => previous + 1,
    0
  );

  return (
    <form action={formAction}>
      <FormMessage variant={count % 2 === 0 ? "success" : "destructive"}>
        {`${count} 回目のメッセージ`}
      </FormMessage>
      <button type="submit">送信</button>
    </form>
  );
};

describe("FormMessage", () => {
  it("shows the status role and the info icon by default", () => {
    render(<FormMessage>保存しました</FormMessage>);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("保存しました")).toBeTruthy();
    expect(screen.getByText("i")).toBeTruthy();
  });

  it("shows the icon for the success variant", () => {
    render(<FormMessage variant="success">成功</FormMessage>);

    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("成功")).toBeTruthy();
  });

  it("the body updates across consecutive Action submissions", async () => {
    // React は Action の完了後にフォームを reset する。resettable element の
    // <output> だとその reset で本文が畳まれ、2 回目以降の更新が DOM に届かない
    // (#1070)。
    render(<ActionForm />);

    const submit = screen.getByRole("button", { name: "送信" });

    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText("1 回目のメッセージ")).toBeTruthy();
    });

    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText("2 回目のメッセージ")).toBeTruthy();
    });
  });
});
