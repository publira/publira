# Toast

The toasts a screen raises after an action, implemented on top of [Base UI Toast](https://base-ui.com/r/components/toast).

`ToastProvider` holds the queue and renders the stack in the bottom-right corner; a component under it raises a toast through `useToastManager`. The parts the stack is drawn from — `ToastViewport`, `ToastRoot`, `ToastContent`, `ToastTitle`, `ToastDescription`, `ToastClose` — are exported for an app that draws its own stack, but `ToastProvider` already renders one, so an app that only raises toasts never mounts them.

## Usage

Mount the provider once, in the layout of the screens that raise toasts. It is a Client Component, so an app wraps it in one of its own:

```tsx
"use client";

import { ToastProvider } from "@publira/ui-components";
import type { ReactNode } from "react";

export const AdminToastProvider = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);
```

Raise a toast from an event handler with the manager's `add`:

```tsx
"use client";

import { useToastManager } from "@publira/ui-components";

export const CommentActionButton = ({ label }: { label: string }) => {
  const { add } = useToastManager();

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
import { ToastProvider, useToastManager } from "@publira/ui-components/toast";
```

## Props

`ToastProvider` takes `children`, `limit` (how many toasts stay on screen at once, default `3`), and `timeout` (how long a toast stays, in milliseconds, default `4000`). The parts take the props of the Base UI part each one wraps, and `useToastManager` is Base UI's own hook.

See the [Base UI Toast documentation](https://base-ui.com/r/components/toast) for the rest.
