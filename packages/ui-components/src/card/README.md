# Card

The card components. A card is made up of the container itself, a header, a title, a description, content, and a footer.

## Usage

```tsx
import * as Card from "@publira/ui-components/card";

export default function Example() {
  return (
    <Card.Root>
      <Card.Header>
        <Card.Title>Card Title</Card.Title>
        <Card.Description>Card description</Card.Description>
      </Card.Header>
      <Card.Content>Card content goes here</Card.Content>
      <Card.Footer>Footer content</Card.Footer>
    </Card.Root>
  );
}
```

## Subpath import

```tsx
import * as Card from "@publira/ui-components/card";
```

## Components

- `Card.Root` - The container for the whole card
- `Card.Header` - The header area
- `Card.Title` - The title
- `Card.Description` - The description
- `Card.Content` - The main content
- `Card.Footer` - The footer area
