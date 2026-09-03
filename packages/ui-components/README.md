# @publira/ui-components

The UI components shared by web-admin, web-host, and the other apps.

## Principles

- Build on Base UI
- Keep the styles consistent with the brand tokens (`@publira/brand/theme.css`)
- Provide thin wrappers so each screen writes fewer one-off classes

## Installing and loading

Add it as a workspace dependency and load the styles from the global CSS.

```css
@import "@publira/ui-components/styles.css";
```

## Main components

### Forms

- [Button / LinkButton](./src/button) - buttons
- [Field / FieldLabel / FieldDescription / FieldError / FieldContent](./src/field) - the form field parts
- [Input](./src/input) - a text input
- [Textarea](./src/textarea) - a multi-line text input
- [Select](./src/select) - a select box
- [Combobox / MultiCombobox](./src/combobox) - searchable single and multiple selection
- [Checkbox](./src/checkbox) - a checkbox
- [RadioGroup](./src/radio-group) - a group of radio buttons
- [Switch](./src/switch) - a toggle switch
- [FormMessage](./src/form-message) - a form message
- [FormActions](./src/form-actions) - the form action area
- [ActionForm](./src/action-form) - a `<form>` around `useActionState`, for a Server Action
- [Skeleton / SkeletonText / SkeletonLine / SkeletonCard](./src/skeleton) - loading placeholders

### Everything else

- [Badge / StatusChip](./src/badge) - status indicators and supplementary labels
- [Dialog / ConfirmDialog](./src/dialog) - the dialogs used to confirm an action
- [Table / TableHeader / TableBody / TableRow / TableHead / TableCell / TableEmptyRow / TableLoadingRow](./src/table) - the table primitives
- [Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter](./src/card) - cards
- [Popover](./src/popover) - the floating surfaces placed in a header and similar places
- [EmptyState](./src/empty-state) - the empty state
- [SectionError / sectionErrorFallback](./src/section-error) - one section of a page that failed to load

## Usage

For how to use a component and for examples, follow its link in the list above.

### Subpath imports

Every component can be imported directly:

```tsx
import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import { Card } from "@publira/ui-components/card";
```

## Development

```bash
pnpm --filter @publira/ui-components build
```
