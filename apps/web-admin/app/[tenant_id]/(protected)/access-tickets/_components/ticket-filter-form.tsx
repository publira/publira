import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { useId } from "react";

import type { AccessTicketFilters } from "../_lib/search-params";

interface TicketFilterFormProps {
  filters: AccessTicketFilters;
}

export const TicketFilterForm = ({ filters }: TicketFilterFormProps) => {
  // Native <select> is not a Field control, so the label needs an id to point at.
  const activeSelectId = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>絞り込み</CardTitle>
        <CardDescription>
          ユーザー、エピソード、状態で発行済みチケットを探せます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field>
            <FieldLabel>ユーザー public_id</FieldLabel>
            <FieldContent>
              <Input
                defaultValue={filters.user}
                name="user"
                placeholder="例: SeedMMBRAAA1"
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>エピソード public_id</FieldLabel>
            <FieldContent>
              <Input
                defaultValue={filters.episode}
                name="episode"
                placeholder="例: SeedEPSDAAA1"
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor={activeSelectId}>状態</FieldLabel>
            <FieldContent>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs"
                defaultValue={filters.active ? "1" : ""}
                id={activeSelectId}
                name="active"
              >
                <option value="">すべて</option>
                <option value="1">有効のみ</option>
              </select>
            </FieldContent>
          </Field>

          <div className="flex items-end gap-2">
            <Button type="submit">適用</Button>
            <Button formAction="?" type="submit" variant="outline">
              リセット
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
