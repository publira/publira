// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CreatorCredits } from "./creator-credits";

afterEach(() => {
  cleanup();
});

describe("CreatorCredits", () => {
  it("Names the role once for the creators who share it", () => {
    render(
      <CreatorCredits
        credits={[
          { name: "Jane Doe", publicId: "CREATOR01", roleName: "Story" },
          { name: "John Roe", publicId: "CREATOR02", roleName: "Art" },
          { name: "Mary Poe", publicId: "CREATOR03", roleName: "Art" },
        ]}
        locale="en"
      />
    );

    expect(screen.getAllByText("Art")).toHaveLength(1);
    expect(screen.getByText("John Roe and Mary Poe")).not.toBeNull();
  });

  it("Keeps the order the API sent, which is the tenant's role priority", () => {
    const { container } = render(
      <CreatorCredits
        credits={[
          { name: "Jane Doe", publicId: "CREATOR01", roleName: "Supervisor" },
          { name: "John Roe", publicId: "CREATOR02", roleName: "Art" },
        ]}
        locale="en"
      />
    );

    expect(container.textContent).toBe("Supervisor Jane Doe/Art John Roe");
  });

  it("Writes a credit that holds no role as the name on its own", () => {
    const { container } = render(
      <CreatorCredits
        credits={[{ name: "Jane Doe", publicId: "CREATOR01", roleName: "" }]}
        locale="en"
      />
    );

    expect(container.textContent).toBe("Jane Doe");
  });

  it("Renders nothing for a work that carries no credits", () => {
    const { container } = render(<CreatorCredits credits={[]} locale="en" />);

    expect(container.textContent).toBe("");
  });
});
