# EmptyState

The "nothing here yet" state of a list or a section.

It is composed, so each region is an element the caller writes: a heading that streams from a catalog carries its own `<Suspense>` boundary, and a region a screen has nothing for is simply left out.

## Usage

```tsx
import { CollectionIcon } from "@publira/icons";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateIcon,
  EmptyStateTitle,
  LinkButton,
} from "@publira/ui-components";

export default function Example() {
  return (
    <EmptyState>
      <EmptyStateIcon>
        <CollectionIcon className="size-6" />
      </EmptyStateIcon>
      <EmptyStateHeading>
        <EmptyStateTitle>No series yet</EmptyStateTitle>
        <EmptyStateDescription>
          Publish one to see it here.
        </EmptyStateDescription>
      </EmptyStateHeading>
      <EmptyStateActions>
        <LinkButton href="/series/new">New series</LinkButton>
      </EmptyStateActions>
    </EmptyState>
  );
}
```

## Subpath import

```tsx
import { EmptyState } from "@publira/ui-components/empty-state";
```

## Props

`EmptyState` takes the props of a `<div>`. Everything a reader sees comes from the slots.
