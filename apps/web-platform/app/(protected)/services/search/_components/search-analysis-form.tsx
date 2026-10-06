import {
  ActionForm,
  ActionFormFieldError,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import type { PlatformSearchSettings } from "#lib/search-settings-shared";

import { updatePlatformSearchAnalysisAction } from "../_lib/actions";

const FORM_ID = "search-analysis-form";

interface SearchAnalysisFormProps {
  settings: Pick<
    PlatformSearchSettings,
    "analysis" | "buildState" | "defaultAnalysis" | "revision"
  >;
}

/**
 * The `settings.analysis` the catalog index is built with, edited as JSON.
 * Saving a definition or going back to the default both start a rebuild,
 * which the status section above follows. A definition the server or the
 * engine refuses stays in the editor, with the reason beside it.
 */
export const SearchAnalysisForm = ({ settings }: SearchAnalysisFormProps) => (
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-28" />}>
            <Message message="platform.search.analysis.title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.search.analysis.description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>

    {/* The saved definition is the one the search answers with only once
        the settings are serving: while their index is built, or after its
        build failed, the search answers from the previous index. */}
    <p className="text-sm text-foreground sm:max-w-3xl">
      {settings.buildState === "serving" && settings.defaultAnalysis ? (
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="platform.search.analysis.current_default" />
        </Suspense>
      ) : null}
      {settings.buildState === "serving" && !settings.defaultAnalysis ? (
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="platform.search.analysis.current_saved" />
        </Suspense>
      ) : null}
      {settings.buildState !== "serving" && settings.defaultAnalysis ? (
        <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
          <Message message="platform.search.analysis.pending_default" />
        </Suspense>
      ) : null}
      {settings.buildState !== "serving" && !settings.defaultAnalysis ? (
        <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
          <Message message="platform.search.analysis.pending_saved" />
        </Suspense>
      ) : null}
    </p>

    <div className="grid gap-2 sm:max-w-3xl">
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="platform.search.analysis.roles_intro" />
        </Suspense>
      </p>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt>
          <code className="font-mono text-sm text-foreground">
            written_form
          </code>
        </dt>
        <dd className="text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.search.analysis.role_written_form" />
          </Suspense>
        </dd>
        <dt>
          <code className="font-mono text-sm text-foreground">
            alternate_form
          </code>
        </dt>
        <dd className="text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.search.analysis.role_alternate_form" />
          </Suspense>
        </dd>
        <dt>
          <code className="font-mono text-sm text-foreground">exact_match</code>
        </dt>
        <dd className="text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.search.analysis.role_exact_match" />
          </Suspense>
        </dd>
      </dl>
    </div>

    <ActionForm
      action={updatePlatformSearchAnalysisAction}
      className="grid gap-5 sm:max-w-3xl"
      id={FORM_ID}
    >
      <input name="revision" type="hidden" value={settings.revision} />

      <ActionFormFieldset>
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.search.analysis.definition" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            {/* A save refreshes the settings; the new revision remounts the
                editor with the definition the server stored. */}
            <Textarea
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="min-h-96"
              defaultValue={settings.analysis}
              key={settings.revision}
              name="analysis"
              spellCheck={false}
            />
            <ActionFormFieldError name="analysis" />
          </FieldContent>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
              <Message message="platform.search.analysis.definition_help" />
            </Suspense>
          </FieldDescription>
        </Field>
      </ActionFormFieldset>

      <div className="flex flex-wrap justify-end gap-2">
        {settings.defaultAnalysis ? null : (
          <ActionFormFieldset>
            <ConfirmDialog>
              <ConfirmDialogTrigger
                render={<Button type="button" variant="outline" />}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="platform.search.analysis.reset" />
                </Suspense>
              </ConfirmDialogTrigger>
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>
                    <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                      <Message message="platform.search.analysis.reset_title" />
                    </Suspense>
                  </ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message message="platform.search.analysis.reset_description" />
                    </Suspense>
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="platform.common.cancel" />
                    </Suspense>
                  </ConfirmDialogCancel>
                  <ConfirmDialogAction
                    form={FORM_ID}
                    name="intent"
                    value="default"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="platform.search.analysis.reset_confirm" />
                    </Suspense>
                  </ConfirmDialogAction>
                </ConfirmDialogFooter>
              </ConfirmDialogContent>
            </ConfirmDialog>
          </ActionFormFieldset>
        )}
        <ActionFormSubmit name="intent" value="replace">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ActionFormIdle>
              <Message message="platform.search.analysis.save" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="platform.search.analysis.saving" />
            </ActionFormPending>
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </PlatformSection>
);
