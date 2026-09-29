# Table

The table primitives: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` wrap the HTML table elements, and `TableEmptyRow`, `TableLoadingRow`, and `TableSkeleton` are the rows and the shape a table shows before it has rows.

The table is the page: rows separated by hairlines, on the paper the screen is already on, with a heavier rule under the header. Nothing wraps it, because a card around a table draws a second boundary around the one the rules already describe. `tabular-nums` sits on the table, so every column of figures lines up without each cell asking for it.

## Usage

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components";

export default function Example({ rows }: { rows: Row[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Episodes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmptyRow colSpan={2}>No series yet.</TableEmptyRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.title}</TableCell>
              <TableCell>{row.episodeCount}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
```

While the rows are still being read, `TableLoadingRow` keeps the header in place and fills the body with placeholder bands:

```tsx
<TableBody>
  <TableLoadingRow colSpan={2} rows={6} />
</TableBody>
```

A screen whose table cannot render at all yet — because the columns themselves wait on the catalog — stands `TableSkeleton` in its place, as a `<Suspense>` fallback, so nothing moves sideways when the data arrives:

```tsx
<Suspense fallback={<TableSkeleton rows={6} />}>
  <OperatorsTable />
</Suspense>
```

## Subpath import

```tsx
import { Table, TableBody, TableCell } from "@publira/ui-components/table";
```

## Props

`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` take the props of the element each one renders (`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`).

- `TableEmptyRow`: `colSpan`, the number of columns the row spans, and `children`, what the empty table says in the caller's locale.
- `TableLoadingRow`: `colSpan`, and `rows`, how many placeholder rows to draw (default `3`).
- `TableSkeleton`: `rows`, how many placeholder bands to draw (default `3`).
