# SectionError

A component that shows that one section of a page failed to load. What is shown when the whole page fails is the job of each app's `ErrorScreen` (`error.tsx`).

It is composed, so every piece of copy is written on the element that carries it and can stream from the caller's catalog behind its own `<Suspense>`.

## Usage

```tsx
import * as SectionError from "@publira/ui-components/section-error";

export default function Example() {
  return (
    <SectionError.Root>
      <SectionError.Heading>
        <SectionError.Title>Could not display the operators</SectionError.Title>
        <SectionError.Description>
          You do not have permission to perform this action. Go back or use an
          account that does.
        </SectionError.Description>
      </SectionError.Heading>
    </SectionError.Root>
  );
}
```

Nothing here reads a hook, so a Server Component can render it. The boundary body that fills these slots from a caught error lives in [`section-error-fallback`](../section-error-fallback), a subpath of its own.

## Subpath import

```tsx
import * as SectionError from "@publira/ui-components/section-error";
```
