// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContactMessageAssigneeOption } from "../../contact-message-types";
import { ContactMessageAssignment } from "./contact-message-assignment";

vi.mock("../_lib/actions", () => ({
  assignContactMessageAction: () => Promise.resolve(null),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

const staffOne: ContactMessageAssigneeOption = {
  name: "Staff One",
  userId: "018f0f80-0001-7000-8000-000000000001",
  userPublicId: "STAFF000001",
};

const staffTwo: ContactMessageAssigneeOption = {
  name: "Staff Two",
  userId: "018f0f80-0001-7000-8000-000000000002",
  userPublicId: "STAFF000002",
};

const unassigned = {
  assigneeName: "",
  assigneePublicId: "",
  assigneeUserId: "",
  id: "018f0f80-0003-7000-8000-000000000001",
  publicId: "CONTACT0001",
};

const assignedTo = (staff: ContactMessageAssigneeOption) => ({
  ...unassigned,
  assigneeName: staff.name,
  assigneePublicId: staff.userPublicId,
  assigneeUserId: staff.userId,
});

/** What the form the named button submits would post. */
const submittedBy = (name: string) => {
  const form = screen.getByRole("button", { name }).closest("form");
  if (!form) {
    throw new Error(`"${name}" submits no form`);
  }
  return Object.fromEntries(new FormData(form));
};

const openOptionLabels = async () => {
  fireEvent.click(screen.getByRole("combobox", { name: "Assignee" }));

  return within(await screen.findByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.textContent);
};

afterEach(() => {
  cleanup();
});

describe("ContactMessageAssignment", () => {
  it("offers nobody first, then every member of staff", async () => {
    render(
      await ContactMessageAssignment({
        assignees: [staffOne, staffTwo],
        contactMessage: unassigned,
        currentUserPublicId: staffOne.userPublicId,
        locale: "en",
        tenantId: "TENANT001",
      })
    );

    expect(await openOptionLabels()).toEqual([
      "Unassigned",
      "Staff One",
      "Staff Two",
    ]);
  });

  it("saves the current assignee unless another is picked, and clears it with nobody", async () => {
    render(
      await ContactMessageAssignment({
        assignees: [staffOne, staffTwo],
        contactMessage: assignedTo(staffTwo),
        currentUserPublicId: staffOne.userPublicId,
        locale: "en",
        tenantId: "TENANT001",
      })
    );

    expect(submittedBy("Save assignee")).toEqual({
      assignee_user_id: staffTwo.userId,
      contact_message_id: unassigned.id,
      public_id: unassigned.publicId,
      tenant_id: "TENANT001",
    });

    const select = screen.getByRole("combobox", { name: "Assignee" });
    fireEvent.click(select);
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(
      await screen.findByRole("option", { name: "Unassigned" }),
      { key: "Enter" }
    );

    expect(submittedBy("Save assignee").assignee_user_id).toBe("");
  });

  it("assigns the message to the member of staff reading it in one press", async () => {
    render(
      await ContactMessageAssignment({
        assignees: [staffOne, staffTwo],
        contactMessage: assignedTo(staffTwo),
        currentUserPublicId: staffOne.userPublicId,
        locale: "en",
        tenantId: "TENANT001",
      })
    );

    expect(submittedBy("Assign to me")).toEqual({
      assignee_user_id: staffOne.userId,
      contact_message_id: unassigned.id,
      public_id: unassigned.publicId,
      tenant_id: "TENANT001",
    });
  });

  it("does not offer to assign the message to whoever already has it", async () => {
    render(
      await ContactMessageAssignment({
        assignees: [staffOne, staffTwo],
        contactMessage: assignedTo(staffOne),
        currentUserPublicId: staffOne.userPublicId,
        locale: "en",
        tenantId: "TENANT001",
      })
    );

    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
  });

  it("still names an assignee who can no longer be picked", async () => {
    render(
      await ContactMessageAssignment({
        assignees: [staffOne],
        contactMessage: assignedTo(staffTwo),
        currentUserPublicId: staffOne.userPublicId,
        locale: "en",
        tenantId: "TENANT001",
      })
    );

    expect(screen.getByRole("combobox", { name: "Assignee" }).textContent).toBe(
      "Staff Two"
    );
  });

  it("closes the controls and says why when the staff could not be read", async () => {
    render(
      await ContactMessageAssignment({
        assignees: [],
        assigneesErrorMessage: "Could not load the staff.",
        contactMessage: unassigned,
        currentUserPublicId: staffOne.userPublicId,
        locale: "en",
        tenantId: "TENANT001",
      })
    );

    expect(screen.getByText("Could not load the staff.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save assignee" }).matches(":disabled")
    ).toBe(true);
  });
});
