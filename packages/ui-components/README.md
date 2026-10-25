# @publira/ui-components

The UI components shared by web-admin, web-storefront, and the other apps.

## Principles

- Build on Base UI
- Keep the styles consistent with the brand tokens (`@publira/brand/theme.css`)
- Provide thin wrappers so each screen writes fewer one-off classes

## Installing and loading

Add it as a workspace dependency and load the styles from the global CSS.

```css
@import "@publira/ui-components/styles.css";
```

## Components

A subpath holds one component. A component that is a tree of parts is exported as a namespace, and one that renders a single element as a plain named export.

### Namespaces

The caller imports the subpath whole and writes each part through it. The root of every tree is `Root`, and every other part is the part's own name without the component's prefix:

```tsx
import * as Dialog from "@publira/ui-components/dialog";

<Dialog.Root>
  <Dialog.Trigger>…</Dialog.Trigger>
  <Dialog.Popup>
    <Dialog.Title>…</Dialog.Title>
  </Dialog.Popup>
</Dialog.Root>;
```

The props types, hooks, and helpers of a tree are in the same namespace (`Field.LabelProps`, `ActionForm.useSettled`, `Toast.useManager`). Each part is still declared under its full name (`DialogTrigger`) and renamed only where its subpath exports it, so React DevTools and stack traces name the component rather than `Root` or `Trigger`.

| Subpath | Namespace | Parts | What it is |
| --- | --- | --- | --- |
| [`action-form`](./src/action-form) | `ActionForm` | `Root`, `Submit`, `Idle`, `Pending`, `Fieldset`, `FieldError`, `useState`, `useSettled` | a `<form>` around `useActionState`, for a Server Action |
| [`card`](./src/card) | `Card` | `Root`, `Header`, `Title`, `Description`, `Content`, `Footer` | a card |
| [`chart`](./src/chart) | `Chart` | `Root`, `Bars`, `Line`, `Steps`, `Axis`, `AxisLabel`, `Caption` | a small chart of one series of figures, drawn as inline SVG |
| [`combobox`](./src/combobox) | `Combobox` | `Root`, `Input`, `Popup`, `Empty`, `Items` | searchable single selection |
| [`confirm-dialog`](./src/confirm-dialog) | `ConfirmDialog` | `Root`, `Trigger`, `Content`, `Header`, `Title`, `Description`, `Footer`, `Cancel`, `Action` | a dialog that confirms an action |
| [`dialog`](./src/dialog) | `Dialog` | `Root`, `Trigger`, `Portal`, `Backdrop`, `Viewport`, `Popup`, `Header`, `Title`, `Description`, `Footer`, `Close` | a modal dialog |
| [`drawer`](./src/drawer) | `Drawer` | `Root`, `Trigger`, `Content`, `Header`, `Title`, `Description`, `Close` | a sheet along the right edge, for the detail of one row of a list |
| [`empty-state`](./src/empty-state) | `EmptyState` | `Root`, `Icon`, `Heading`, `Title`, `Description`, `Actions` | the empty state |
| [`field`](./src/field) | `Field` | `Root`, `Label`, `Description`, `Error`, `Content` | the form field parts |
| [`figure-line`](./src/figure-line) | `FigureLine` | `Root`, `Figure`, `Label`, `Value` | a line of labelled figures, such as counts or amounts |
| [`identifier`](./src/identifier) | `Identifier` | `Root`, `Value`, `Copy` | a public ID or a code an operator copies off a detail screen |
| [`locale-switcher`](./src/locale-switcher) | `LocaleSwitcher` | `Root`, `Trigger`, `Content`, `Title`, `Options`, `Option` | the display-language control a header offers |
| [`multi-combobox`](./src/multi-combobox) | `MultiCombobox` | `Root`, `InputGroup`, `Chips`, `Chip`, `ChipRemove`, `Input`, `Popup`, `Empty`, `Items` | searchable multiple selection |
| [`password-input`](./src/password-input) | `PasswordInput` | `Root`, `Control`, `Toggle` | a password input whose value can be shown and masked again |
| [`popover`](./src/popover) | `Popover` | `Root`, `Trigger`, `Content`, `Title` | the floating surfaces placed in a header and similar places |
| [`section-error`](./src/section-error) | `SectionError` | `Root`, `Heading`, `Title`, `Description`, `Actions` | one section of a page that failed to load |
| [`section-error-fallback`](./src/section-error-fallback) | `SectionErrorCatch` | `Root`, `Retry`, `Digest` | a section-level error boundary |
| [`table`](./src/table) | `Table` | `Root`, `Header`, `Body`, `Row`, `Head`, `Cell`, `EmptyRow`, `LoadingRow`, `Skeleton` | the table primitives |
| [`tabs`](./src/tabs) | `Tabs` | `Root`, `List`, `Tab`, `Panel` | one panel at a time, with the row of tabs that switches them |
| [`toast`](./src/toast) | `Toast` | `Provider`, `useManager`, `Viewport`, `Root`, `Content`, `Title`, `Description`, `Close` | the toasts a screen raises after an action |

### Single elements

A component that renders one element is imported by name. A namespace holding only `Root` would be ceremony.

```tsx
import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
```

- [Button / LinkButton / buttonVariants](./src/button) - buttons
- [Badge / StatusChip / badgeVariants](./src/badge) - status indicators and supplementary labels
- [Checkbox](./src/checkbox) - a checkbox
- [Fieldset](./src/fieldset) - a group of fields closed as one
- [FormActions](./src/form-actions) - the form action area
- [FormMessage](./src/form-message) - a form message
- [Input](./src/input) - a text input
- [OfflineNotice](./src/offline-notice) - the floating notice shown while the connection is gone
- [QrCode / toQrCodePath](./src/qr-code) - a QR code for a camera to read
- [RadioGroup](./src/radio-group) - a group of radio buttons
- [Select](./src/select) - a select box
- [Skeleton / SkeletonText / SkeletonLine / SkeletonCard](./src/skeleton) - loading placeholders, variants of one placeholder rather than parts of one tree
- [Switch](./src/switch) - a toggle switch
- [Textarea](./src/textarea) - a multi-line text input

The package has no root entry: every component is imported from its subpath. For how to use a component and for examples, follow its link.

## Development

```bash
pnpm build --filter @publira/ui-components
```
