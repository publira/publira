# Card

The card components. A card is made up of the container itself, a header, a title, a description, content, and a footer.

## Usage

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@publira/ui-components";

export default function Example() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description</CardDescription>
      </CardHeader>
      <CardContent>Card content goes here</CardContent>
      <CardFooter>Footer content</CardFooter>
    </Card>
  );
}
```

## Subpath import

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@publira/ui-components/card";
```

## Components

- `Card` - The container for the whole card
- `CardHeader` - The header area
- `CardTitle` - The title
- `CardDescription` - The description
- `CardContent` - The main content
- `CardFooter` - The footer area
