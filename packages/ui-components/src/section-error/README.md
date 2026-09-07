# SectionError

A component that shows that one section of a page failed to load. What is shown when the whole page fails is the job of each app's `ErrorScreen` (`error.tsx`).

It is composed, so every piece of copy is written on the element that carries it and can stream from the caller's catalog behind its own `<Suspense>`.

## Usage

```tsx
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components";

export default function Example() {
  return (
    <SectionError>
      <SectionErrorHeading>
        <SectionErrorTitle>Could not display the operators</SectionErrorTitle>
        <SectionErrorDescription>
          You do not have permission to perform this action.
        </SectionErrorDescription>
      </SectionErrorHeading>
    </SectionError>
  );
}
```

Nothing here reads a hook, so a Server Component can render it. The boundary body that fills these slots from a caught error lives in [`section-error-fallback`](../section-error-fallback), a subpath of its own.

## Subpath import

```tsx
import { SectionError } from "@publira/ui-components/section-error";
```
