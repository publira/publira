# Table

The table primitives: `Table.Root`, `Table.Header`, `Table.Body`, `Table.Row`, `Table.Head`, and `Table.Cell` wrap the HTML table elements, and `Table.EmptyRow`, `Table.LoadingRow`, and `Table.Skeleton` are the rows and the shape a table shows before it has rows.

The table is the page: rows separated by hairlines, on the paper the screen is already on, with a heavier rule under the header. Nothing wraps it, because a card around a table draws a second boundary around the one the rules already describe. `tabular-nums` sits on the table, so every column of figures lines up without each cell asking for it.

## Usage

```tsx
import * as Table from "@publira/ui-components/table";

export default function Example({ rows }: { rows: Row[] }) {
  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Title</Table.Head>
          <Table.Head>Episodes</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.length === 0 ? (
          <Table.EmptyRow colSpan={2}>No series yet.</Table.EmptyRow>
        ) : (
          rows.map((row) => (
            <Table.Row key={row.id}>
              <Table.Cell>{row.title}</Table.Cell>
              <Table.Cell>{row.episodeCount}</Table.Cell>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table.Root>
  );
}
```

While the rows are still being read, `Table.LoadingRow` keeps the header in place and fills the body with placeholder bands:

```tsx
<Table.Body>
  <Table.LoadingRow colSpan={2} rows={6} />
</Table.Body>
```

A screen whose table cannot render at all yet — because the columns themselves wait on the catalog — stands `Table.Skeleton` in its place, as a `<Suspense>` fallback, so nothing moves sideways when the data arrives:

```tsx
<Suspense fallback={<Table.Skeleton rows={6} />}>
  <OperatorsTable />
</Suspense>
```

## Subpath import

```tsx
import * as Table from "@publira/ui-components/table";
```

## Props

`Table.Root`, `Table.Header`, `Table.Body`, `Table.Row`, `Table.Head`, and `Table.Cell` take the props of the element each one renders (`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`).

- `Table.EmptyRow`: `colSpan`, the number of columns the row spans, and `children`, what the empty table says in the caller's locale.
- `Table.LoadingRow`: `colSpan`, and `rows`, how many placeholder rows to draw (default `3`).
- `Table.Skeleton`: `rows`, how many placeholder bands to draw (default `3`).
