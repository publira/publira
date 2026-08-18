import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

interface PublishAtInputProps {
  defaultValue?: string;
  name?: string;
  timeZone: string;
}

export const PublishAtInput = ({
  defaultValue,
  name = "publish_at",
  timeZone,
}: PublishAtInputProps) => (
  <Field>
    <FieldLabel>publish_at</FieldLabel>
    <FieldContent>
      <input defaultValue="" name={name} type="hidden" />
      <Input
        defaultValue={defaultValue}
        name={`${name}_local`}
        step={60}
        type="datetime-local"
      />
      <FieldDescription>
        未入力の場合は下書きとして入稿します。入力するとテナントのタイムゾーン（
        {timeZone}）の壁時計として予約公開します。
      </FieldDescription>
    </FieldContent>
  </Field>
);
