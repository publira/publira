# EmptyState

The "nothing here yet" state of a list or a section.

It is composed, so each region is an element the caller writes: a heading that streams from a catalog carries its own `<Suspense>` boundary, and a region a screen has nothing for is simply left out.

## Usage

```tsx
import { CollectionIcon } from "@publira/icons";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";

export default function Example() {
  return (
    <EmptyState.Root>
      <EmptyState.Icon>
        <CollectionIcon className="size-6" />
      </EmptyState.Icon>
      <EmptyState.Heading>
        <EmptyState.Title>No series yet</EmptyState.Title>
        <EmptyState.Description>
          Publish one to see it here.
        </EmptyState.Description>
      </EmptyState.Heading>
      <EmptyState.Actions>
        <LinkButton href="/series/new">New series</LinkButton>
      </EmptyState.Actions>
    </EmptyState.Root>
  );
}
```

## Subpath import

```tsx
import * as EmptyState from "@publira/ui-components/empty-state";
```

## Props

`EmptyState.Root` takes the props of a `<div>`. Everything a reader sees comes from the slots.
