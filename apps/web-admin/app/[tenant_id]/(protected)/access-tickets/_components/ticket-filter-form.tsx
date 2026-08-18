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

import type { AccessTicketFilters } from "../_lib/search-params";
import { TicketFilterActiveSelect } from "./ticket-filter-active-select";

interface TicketFilterFormProps {
  filters: AccessTicketFilters;
}

export const TicketFilterForm = ({ filters }: TicketFilterFormProps) => (
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

        <TicketFilterActiveSelect defaultValue={filters.active ? "1" : ""} />

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
