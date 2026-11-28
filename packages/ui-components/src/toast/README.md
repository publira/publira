# Toast

The toasts a screen raises after an action, implemented on top of [Base UI Toast](https://base-ui.com/r/components/toast).

`Toast.Provider` holds the queue, `Toast.Stack` draws it in the bottom-right corner, and a component under the provider raises a toast through `Toast.useManager`. What `Toast.Stack` is given as children is drawn in every toast beside its title and description: that is where the app writes `Toast.Close`, named in the reader's language with `aria-label`. The other parts the stack is drawn from — `Toast.Viewport`, `Toast.Root`, `Toast.Content`, `Toast.Title`, `Toast.Description` — are exported for an app that draws its own stack, so an app that only raises toasts never mounts them.

## Usage

Mount the provider and the stack once, in the layout of the screens that raise toasts. They are Client Components, so an app wraps them in one of its own:

```tsx
"use client";

import * as Toast from "@publira/ui-components/toast";
import type { ReactNode } from "react";

import { useClientMessages } from "./client-message";

const CloseControl = () => {
  const t = useClientMessages();

  return <Toast.Close aria-label={t("admin.common.close")} />;
};

export const AdminToastProvider = ({ children }: { children: ReactNode }) => (
  <Toast.Provider>
    {children}
    <Toast.Stack>
      <CloseControl />
    </Toast.Stack>
  </Toast.Provider>
);
```

The component carries no copy of its own, and the close control's content is an icon, which a screen reader does not announce: its `aria-label` is the only name it has.

Raise a toast from an event handler with the manager's `add`:

```tsx
"use client";

import * as Toast from "@publira/ui-components/toast";

export const CommentActionButton = ({ label }: { label: string }) => {
  const { add } = Toast.useManager();

  return (
    <button
      onClick={() => add({ title: label, type: "success" })}
      type="button"
    >
      {label}
    </button>
  );
};
```

`type` picks the tone: `success` and `destructive` colour the toast, and any other value leaves it neutral. A toast closes on its own after `timeout`, or when its close control is pressed.

## Subpath import

```tsx
import * as Toast from "@publira/ui-components/toast";
```

## Props

`Toast.Provider` takes `children`, `limit` (how many toasts stay on screen at once, default `3`), and `timeout` (how long a toast stays, in milliseconds, default `4000`). `Toast.Stack` takes `children`, drawn in every toast. The other parts take the props of the Base UI part each one wraps, and `Toast.Close` also requires `aria-label`, since its default content is a close icon; `Toast.useManager` is Base UI's own hook.

See the [Base UI Toast documentation](https://base-ui.com/r/components/toast) for the rest.
