import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

interface PublishAtInputProps {
  defaultValue?: string;
  id?: string;
  name?: string;
}

export const PublishAtInput = ({
  defaultValue,
  id = "episode_publish_at",
  name = "publish_at",
}: PublishAtInputProps) => (
  <Field>
    <FieldLabel htmlFor={id}>publish_at</FieldLabel>
    <FieldContent>
      <Input
        defaultValue={defaultValue}
        id={id}
        name={name}
        step={60}
        type="datetime-local"
      />
      <FieldDescription>
        未入力の場合は下書きとして入稿します。入力すると指定日時に予約公開します。
      </FieldDescription>
    </FieldContent>
  </Field>
);
