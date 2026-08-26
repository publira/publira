import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";

import { requestPlatformEmailChangeAction } from "../../_lib/actions";

export const EmailChangeForm = () => (
  <Card>
    <CardHeader>
      <CardTitle>
        <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
          <Message message="platform.settings.email_change_title" />
        </Suspense>
      </CardTitle>
      <CardDescription>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="platform.settings.email_change_description" />
        </Suspense>
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ActionForm
        action={requestPlatformEmailChangeAction}
        className="grid gap-4"
      >
        <Field>
          <FieldLabel htmlFor="current_email" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.settings.email_change_current" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              id="current_email"
              name="current_email"
              placeholder="current@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="new_email" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.settings.email_change_new" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              id="new_email"
              name="new_email"
              placeholder="new@example.com"
              required
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="current_password" required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.settings.email_change_password" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="current-password"
              id="current_password"
              name="current_password"
              placeholder="••••••••"
              required
              type="password"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="platform.settings.email_change_password_help" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.settings.email_change_submit" />
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </CardContent>
  </Card>
);
