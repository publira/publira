"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import { Select } from "@publira/ui-components/select";
import { Textarea } from "@publira/ui-components/textarea";
import { createContext, use, useMemo, useOptimistic, useState } from "react";
import type { ReactNode } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";

import {
  buildVersionDiff,
  getDefaultComparisonVersionId,
} from "../_lib/version-diff";
import type { PageFormState, PageVersionListItem } from "../page-types";
import { MarkdownPreview } from "./markdown-preview";

interface PageDraftContextValue {
  compareVersionId: string;
  content: string;
  onCompareVersionChange: (versionId: string) => void;
  onContentChange: (content: string) => void;
  onLoadVersion: (versionId: string) => void;
  onSaveStart: () => void;
  onSelectedVersionChange: (versionId: string) => void;
  publishedVersionId: string;
  saving: boolean;
  selectedVersionId: string;
  versions: PageVersionListItem[];
}

const PageDraftContext = createContext<PageDraftContextValue | null>(null);

const usePageDraft = () => {
  const context = use(PageDraftContext);
  if (!context) {
    throw new Error("PageDraft slots must be rendered inside PageDraft.");
  }
  return context;
};

/**
 * The body being edited and the two versions being compared. Loading a version
 * writes both, so they sit together above the form and the version list.
 */
export const PageDraft = ({
  children,
  publishedVersionId,
  versions,
}: {
  children: ReactNode;
  publishedVersionId: string;
  /** Newest first, as the API lists them. */
  versions: PageVersionListItem[];
}) => {
  const [content, setContent] = useState(
    () => versions[0]?.contentMarkdown ?? ""
  );
  const [selectedVersionId, setSelectedVersionId] = useState(
    () => versions[0]?.id ?? ""
  );
  const [compareVersionId, setCompareVersionId] = useState(() =>
    getDefaultComparisonVersionId(publishedVersionId, versions)
  );
  // Only true inside the save's own transition, so it falls back on its own
  // however the save ends, including the redirect a successful one ends in.
  const [saving, setSaving] = useOptimistic(false);

  const value = useMemo<PageDraftContextValue>(
    () => ({
      compareVersionId,
      content,
      onCompareVersionChange: setCompareVersionId,
      onContentChange: setContent,
      onLoadVersion: (versionId) => {
        const version = versions.find((entry) => entry.id === versionId);
        if (!version) {
          return;
        }
        setContent(version.contentMarkdown);
        setSelectedVersionId(version.id);
      },
      onSaveStart: () => {
        setSaving(true);
      },
      // A version is never compared with itself, so choosing the one on the
      // other side moves that side to another.
      onSelectedVersionChange: (versionId) => {
        setSelectedVersionId(versionId);
        if (compareVersionId === versionId) {
          const fallback = versions.find(
            (version) =>
              version.id !== selectedVersionId && version.id !== versionId
          );
          setCompareVersionId(fallback?.id ?? "");
        }
      },
      publishedVersionId,
      saving,
      selectedVersionId,
      versions,
    }),
    [
      compareVersionId,
      content,
      publishedVersionId,
      saving,
      selectedVersionId,
      setSaving,
      versions,
    ]
  );

  return <PageDraftContext value={value}>{children}</PageDraftContext>;
};

/** The save form, which tells the version list that a save is in flight. */
export const PageSaveForm = ({
  action,
  children,
  className,
}: {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  children: ReactNode;
  className?: string;
}) => {
  const { onSaveStart } = usePageDraft();

  return (
    <ActionForm
      action={(prevState: PageFormState, formData: FormData) => {
        onSaveStart();
        return action(prevState, formData);
      }}
      className={className}
    >
      {children}
    </ActionForm>
  );
};

/** The body as Markdown, posted as `content_markdown`. */
export const PageDraftTextarea = () => {
  const { content, onContentChange } = usePageDraft();

  return (
    <Textarea
      name="content_markdown"
      onChange={(event) => onContentChange(event.target.value)}
      rows={14}
      value={content}
    />
  );
};

/** The body as it would be published, unsaved edits included. */
export const PageDraftPreview = () => {
  const { content } = usePageDraft();

  return <MarkdownPreview content={content} />;
};

/**
 * Puts a version's body in the editor; `children` are its wording. Closed while
 * a save is in flight, which has already taken the body the editor held.
 */
export const PageVersionLoadButton = ({
  children,
  versionId,
}: {
  children: ReactNode;
  versionId: string;
}) => {
  const { onLoadVersion, saving } = usePageDraft();

  return (
    <Button
      disabled={saving}
      onClick={() => onLoadVersion(versionId)}
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  );
};

/** One version as a choice, named by its number and where it stands. */
const useVersionItems = () => {
  const t = useClientMessages();
  const { publishedVersionId, versions } = usePageDraft();

  // The status is interpolated into another message, so it has to be a string.
  return versions.map((version) => {
    let status = t("admin.pages.workspace.draft");
    if (publishedVersionId === version.id) {
      status = t("admin.pages.workspace.published");
    } else if (version.status === "published") {
      status = t("admin.pages.workspace.past_published");
    }

    return {
      label: t("admin.pages.workspace.version_option", {
        status,
        version: String(version.versionNumber),
      }),
      value: version.id,
    };
  });
};

/** The version a comparison starts from. */
export const PageDiffFromSelect = () => {
  const { onSelectedVersionChange, selectedVersionId } = usePageDraft();
  const items = useVersionItems();

  return (
    <Select
      items={items}
      onValueChange={onSelectedVersionChange}
      value={selectedVersionId}
    />
  );
};

/** The version a comparison is made against, never the one it starts from. */
export const PageDiffToSelect = () => {
  const { compareVersionId, onCompareVersionChange, selectedVersionId } =
    usePageDraft();
  const items = useVersionItems();

  return (
    <Select
      items={items.filter((item) => item.value !== selectedVersionId)}
      onValueChange={onCompareVersionChange}
      value={compareVersionId}
    />
  );
};

const getDiffLineDisplay = (line: {
  type: "added" | "removed" | "unchanged";
}) => {
  if (line.type === "added") {
    return {
      className: "bg-emerald-500/10 text-emerald-700",
      prefix: "+",
    };
  }

  if (line.type === "removed") {
    return {
      className: "bg-rose-500/10 text-rose-700",
      prefix: "-",
    };
  }

  return {
    className: "text-muted-foreground",
    prefix: " ",
  };
};

/** What changed between the two versions chosen, line by line. */
export const PageVersionDiff = () => {
  const { compareVersionId, selectedVersionId, versions } = usePageDraft();
  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ?? versions[0];
  const compareVersion = versions.find(
    (version) => version.id === compareVersionId
  );
  if (!selectedVersion || !compareVersion) {
    return null;
  }

  const diffResult = buildVersionDiff(
    selectedVersion.contentMarkdown,
    compareVersion.contentMarkdown
  );
  const counts = new Map<string, number>();
  const diffLineEntries = diffResult.lines.map((line) => {
    const fingerprint = `${line.type}:${line.value}`;
    const count = counts.get(fingerprint) ?? 0;
    counts.set(fingerprint, count + 1);
    return {
      key: `${fingerprint}:${count}`,
      line,
    };
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge tone="info">
          <ClientMessage
            message="admin.pages.workspace.diff_added"
            values={{
              count: diffResult.summary.added,
            }}
          />
        </Badge>
        <Badge tone="warning">
          <ClientMessage
            message="admin.pages.workspace.diff_removed"
            values={{
              count: diffResult.summary.removed,
            }}
          />
        </Badge>
        <Badge tone="muted">
          <ClientMessage
            message="admin.pages.workspace.diff_unchanged"
            values={{
              count: diffResult.summary.unchanged,
            }}
          />
        </Badge>
      </div>

      <div className="overflow-hidden border border-border bg-card">
        <div className="max-h-105 overflow-auto text-xs leading-6">
          {diffLineEntries.map(({ key, line }) => {
            const display = getDiffLineDisplay(line);

            return (
              <code
                className={`grid grid-cols-[24px_minmax(0,1fr)] gap-3 px-4 py-1 font-mono ${display.className}`}
                key={key}
              >
                <span>{display.prefix}</span>
                <span className="wrap-break-word whitespace-pre-wrap">
                  {line.value || " "}
                </span>
              </code>
            );
          })}
        </div>
      </div>
    </>
  );
};
