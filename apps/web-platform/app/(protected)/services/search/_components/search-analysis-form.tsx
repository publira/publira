import { getLocaleLabel, getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
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
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@publira/ui-components/tabs";
import { Textarea } from "@publira/ui-components/textarea";
import { formatList } from "@publira/utils";
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

const SHARED_TAB = "shared";
const SHARED_FORM_ID = "search-analysis-form";

const localeFormId = (analysisLocale: Locale): string =>
  `search-analysis-form-${analysisLocale}`;

type AnalysisSettings = Pick<
  PlatformSearchSettings,
  "analysis" | "buildState" | "defaultAnalysis" | "localeAnalyses" | "revision"
>;

const AnalysisRoles = () => (
  <div className="grid gap-2 sm:max-w-3xl">
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <Message message="platform.search.analysis.roles_intro" />
      </Suspense>
    </p>
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt>
        <code className="font-mono text-sm text-foreground">written_form</code>
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
);

/**
 * The editor of one definition. A save refreshes the settings, and the new
 * revision remounts it with the definition the server stored.
 */
const DefinitionEditor = ({
  definition,
  revision,
}: {
  definition: string;
  revision: string;
}) => (
  <>
    <FieldLabel>
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="platform.search.analysis.definition" />
      </Suspense>
    </FieldLabel>
    <FieldContent>
      <Textarea
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="min-h-96"
        defaultValue={definition}
        key={revision}
        name="analysis"
        spellCheck={false}
      />
      <ActionFormFieldError name="analysis" />
    </FieldContent>
  </>
);

const SaveButton = () => (
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
);

/**
 * Which languages are built from the shared definition, by their autonyms in
 * the list style of the language the console is shown in.
 */
const SharedUsedBy = ({
  locale,
  settings,
}: {
  locale: Locale;
  settings: AnalysisSettings;
}) => {
  const sharedBy = getLocales().filter(
    (code) => settings.localeAnalyses[code] === undefined
  );
  if (sharedBy.length === 0) {
    return <Message message="platform.search.analysis.shared_used_by_none" />;
  }
  if (sharedBy.length === getLocales().length) {
    return <Message message="platform.search.analysis.shared_used_by_all" />;
  }
  return (
    <Message
      message="platform.search.analysis.shared_used_by"
      values={{
        languages: formatList(sharedBy.map(getLocaleLabel), { locale }),
      }}
    />
  );
};

/**
 * The shared definition, which every language without one of its own is
 * built from. It resets to the default the server ships.
 *
 * The saved definition is the one the search answers with only once the
 * settings are serving: while their indices are built, or after their build
 * failed, the search answers from the previous ones.
 */
const SharedAnalysisForm = ({
  locale,
  settings,
}: {
  locale: Locale;
  settings: AnalysisSettings;
}) => (
  <>
    <div className="grid gap-1">
      <p className="text-sm text-foreground">
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
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <SharedUsedBy locale={locale} settings={settings} />
        </Suspense>
      </p>
    </div>

    <ActionForm
      action={updatePlatformSearchAnalysisAction}
      className="grid gap-5"
      id={SHARED_FORM_ID}
    >
      <input name="revision" type="hidden" value={settings.revision} />
      <input name="analysis_locale" type="hidden" value="" />

      <ActionFormFieldset>
        <Field>
          <DefinitionEditor
            definition={settings.analysis}
            revision={settings.revision}
          />
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
                    form={SHARED_FORM_ID}
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
        <SaveButton />
      </div>
    </ActionForm>
  </>
);

/**
 * One language's definition. A language without one of its own is built from
 * the shared definition, which its editor starts from, so saving the editor
 * unchanged is how the language is kept from later changes to the shared one.
 * Its own definition resets to the shared one.
 */
const LocaleAnalysisForm = ({
  analysisLocale,
  settings,
}: {
  analysisLocale: Locale;
  settings: AnalysisSettings;
}) => {
  const own = settings.localeAnalyses[analysisLocale];
  const formId = localeFormId(analysisLocale);
  const language = { language: getLocaleLabel(analysisLocale) };

  return (
    <>
      <p className="text-sm text-foreground">
        {settings.buildState === "serving" && own === undefined ? (
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="platform.search.analysis.locale_current_shared" />
          </Suspense>
        ) : null}
        {settings.buildState === "serving" && own !== undefined ? (
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="platform.search.analysis.locale_current_own" />
          </Suspense>
        ) : null}
        {settings.buildState !== "serving" && own === undefined ? (
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.search.analysis.locale_pending_shared" />
          </Suspense>
        ) : null}
        {settings.buildState !== "serving" && own !== undefined ? (
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.search.analysis.locale_pending_own" />
          </Suspense>
        ) : null}
      </p>

      <ActionForm
        action={updatePlatformSearchAnalysisAction}
        className="grid gap-5"
        id={formId}
      >
        <input name="revision" type="hidden" value={settings.revision} />
        <input name="analysis_locale" type="hidden" value={analysisLocale} />

        <ActionFormFieldset>
          <Field>
            <DefinitionEditor
              definition={own ?? settings.analysis}
              revision={settings.revision}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
                <Message message="platform.search.analysis.locale_definition_help" />
              </Suspense>
            </FieldDescription>
          </Field>
        </ActionFormFieldset>

        <div className="flex flex-wrap justify-end gap-2">
          {own === undefined ? null : (
            <ActionFormFieldset>
              <ConfirmDialog>
                <ConfirmDialogTrigger
                  render={<Button type="button" variant="outline" />}
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                    <Message message="platform.search.analysis.use_shared" />
                  </Suspense>
                </ConfirmDialogTrigger>
                <ConfirmDialogContent>
                  <ConfirmDialogHeader>
                    <ConfirmDialogTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-64" />}
                      >
                        <Message
                          message="platform.search.analysis.use_shared_title"
                          values={language}
                        />
                      </Suspense>
                    </ConfirmDialogTitle>
                    <ConfirmDialogDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message
                          message="platform.search.analysis.use_shared_description"
                          values={language}
                        />
                      </Suspense>
                    </ConfirmDialogDescription>
                  </ConfirmDialogHeader>
                  <ConfirmDialogFooter>
                    <ConfirmDialogCancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="platform.common.cancel" />
                      </Suspense>
                    </ConfirmDialogCancel>
                    <ConfirmDialogAction
                      form={formId}
                      name="intent"
                      value="shared"
                    >
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.search.analysis.use_shared_confirm" />
                      </Suspense>
                    </ConfirmDialogAction>
                  </ConfirmDialogFooter>
                </ConfirmDialogContent>
              </ConfirmDialog>
            </ActionFormFieldset>
          )}
          <SaveButton />
        </div>
      </ActionForm>
    </>
  );
};

interface SearchAnalysisFormProps {
  /** The language the console is shown in, which lists of languages follow. */
  locale: Locale;
  settings: AnalysisSettings;
}

/**
 * The `settings.analysis` the catalog indices are built with, edited as JSON:
 * the shared definition, and one tab per language the catalog keeps an index
 * for, in the order the server builds them. Saving a definition or resetting
 * one both start a rebuild, which the status section above follows. A
 * definition the server or the engine refuses stays in its editor, with the
 * reason beside it.
 */
export const SearchAnalysisForm = ({
  locale,
  settings,
}: SearchAnalysisFormProps) => (
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

    <AnalysisRoles />

    {/* Every panel stays mounted, so an edit in one tab survives a look at
        another. */}
    <Tabs className="sm:max-w-3xl" defaultValue={SHARED_TAB}>
      <TabsList className="flex-wrap">
        <TabsTab value={SHARED_TAB}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.search.analysis.shared_tab" />
          </Suspense>
        </TabsTab>
        {getLocales().map((code) => (
          <TabsTab key={code} value={code}>
            <span lang={code}>{getLocaleLabel(code)}</span>
          </TabsTab>
        ))}
      </TabsList>
      <TabsPanel className="grid gap-4" keepMounted value={SHARED_TAB}>
        <SharedAnalysisForm locale={locale} settings={settings} />
      </TabsPanel>
      {getLocales().map((code) => (
        <TabsPanel className="grid gap-4" key={code} keepMounted value={code}>
          <LocaleAnalysisForm analysisLocale={code} settings={settings} />
        </TabsPanel>
      ))}
    </Tabs>
  </PlatformSection>
);
