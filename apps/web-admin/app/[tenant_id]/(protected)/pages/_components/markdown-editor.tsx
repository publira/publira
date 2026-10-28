"use client";

import { Toolbar } from "@base-ui/react/toolbar";
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TextQuoteIcon,
} from "@publira/icons";
import type { IconProps } from "@publira/icons";
import { Button, buttonVariants } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import * as Popover from "@publira/ui-components/popover";
import { cn } from "@publira/utils";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Fragment, useEffect, useState } from "react";
import type { ComponentType } from "react";
import { useFormStatus } from "react-dom";

import { useClientMessages } from "#components/client-message";
import type { AdminClientMessageKey } from "#lib/messages";

/**
 * Everything the storefront's renderer draws, so a body written as Markdown
 * before this editor existed loads into it without losing a table, a task
 * list, or an image the toolbar has no button for. Underline is left out:
 * Markdown has no syntax for it, so the storefront could never show it.
 */
const EXTENSIONS = [
  StarterKit.configure({
    link: { autolink: true, openOnClick: false },
    underline: false,
  }),
  Image,
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown,
];

/**
 * The body as it reads, in the console's own face. Code takes the monospace
 * face from the base styles of `<code>` and `<pre>`.
 */
const CONTENT_CLASS_NAME = cn(
  "min-h-72 px-3 py-2 text-sm leading-7 text-foreground outline-none",
  "[&>*+*]:mt-4",
  "[&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_h3,&_h4,&_h5,&_h6]:text-xl [&_h3,&_h4,&_h5,&_h6]:font-semibold [&_h3,&_h4,&_h5,&_h6]:tracking-tight",
  "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6",
  "[&_li[data-checked]]:flex [&_li[data-checked]]:gap-2 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0",
  "[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_:not(pre)>code]:rounded-control [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.95em]",
  "[&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/30 [&_pre]:p-4 [&_pre]:text-xs [&_pre]:leading-6",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_table]:w-full [&_table]:border-collapse [&_td,&_th]:border [&_td,&_th]:border-border [&_td,&_th]:px-3 [&_td,&_th]:py-2 [&_th]:text-left [&_th]:font-medium",
  "[&_img]:max-w-full"
);

interface Format {
  icon: ComponentType<IconProps>;
  isActive: (editor: Editor) => boolean;
  label: AdminClientMessageKey;
  toggle: (editor: Editor) => void;
}

/** The toolbar's groups, in the order a writer meets them. */
const FORMAT_GROUPS: { formats: Format[]; key: string }[] = [
  {
    formats: [
      {
        icon: Heading2Icon,
        isActive: (editor) => editor.isActive("heading", { level: 2 }),
        label: "admin.pages.editor.heading",
        toggle: (editor) =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        icon: Heading3Icon,
        isActive: (editor) => editor.isActive("heading", { level: 3 }),
        label: "admin.pages.editor.subheading",
        toggle: (editor) =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    key: "headings",
  },
  {
    formats: [
      {
        icon: BoldIcon,
        isActive: (editor) => editor.isActive("bold"),
        label: "admin.pages.editor.bold",
        toggle: (editor) => editor.chain().focus().toggleBold().run(),
      },
      {
        icon: ItalicIcon,
        isActive: (editor) => editor.isActive("italic"),
        label: "admin.pages.editor.italic",
        toggle: (editor) => editor.chain().focus().toggleItalic().run(),
      },
      {
        icon: StrikethroughIcon,
        isActive: (editor) => editor.isActive("strike"),
        label: "admin.pages.editor.strikethrough",
        toggle: (editor) => editor.chain().focus().toggleStrike().run(),
      },
      {
        icon: CodeIcon,
        isActive: (editor) => editor.isActive("code"),
        label: "admin.pages.editor.code",
        toggle: (editor) => editor.chain().focus().toggleCode().run(),
      },
    ],
    key: "marks",
  },
  {
    formats: [
      {
        icon: ListIcon,
        isActive: (editor) => editor.isActive("bulletList"),
        label: "admin.pages.editor.bullet_list",
        toggle: (editor) => editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: ListOrderedIcon,
        isActive: (editor) => editor.isActive("orderedList"),
        label: "admin.pages.editor.ordered_list",
        toggle: (editor) => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        icon: TextQuoteIcon,
        isActive: (editor) => editor.isActive("blockquote"),
        label: "admin.pages.editor.quote",
        toggle: (editor) => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        icon: SquareCodeIcon,
        isActive: (editor) => editor.isActive("codeBlock"),
        label: "admin.pages.editor.code_block",
        toggle: (editor) => editor.chain().focus().toggleCodeBlock().run(),
      },
    ],
    key: "blocks",
  },
];

const TOOLBAR_BUTTON_CLASS_NAME = cn(
  buttonVariants({ size: "icon", variant: "ghost" }),
  "aria-pressed:bg-muted"
);

/**
 * Edits the link the caret is in, or makes one of the selection. With nothing
 * selected, the address goes in as the link's own text.
 */
const LinkControl = ({
  active,
  disabled,
  editor,
}: {
  active: boolean;
  disabled: boolean;
  editor: Editor | null;
}) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");

  const apply = () => {
    setOpen(false);
    if (!editor) {
      return;
    }

    const value = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!value) {
      chain.unsetLink().run();
    } else if (editor.state.selection.empty && !active) {
      chain
        .insertContent({
          marks: [{ attrs: { href: value }, type: "link" }],
          text: value,
          type: "text",
        })
        .run();
    } else {
      chain.setLink({ href: value }).run();
    }
  };

  const remove = () => {
    setOpen(false);
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  return (
    <Popover.Root
      onOpenChange={(next) => {
        if (next) {
          setHref(editor?.getAttributes("link").href ?? "");
        }
        setOpen(next);
      }}
      open={open}
    >
      <Toolbar.Button
        aria-label={t("admin.pages.editor.link")}
        aria-pressed={active}
        className={TOOLBAR_BUTTON_CLASS_NAME}
        disabled={disabled}
        render={<Popover.Trigger />}
      >
        <LinkIcon aria-hidden="true" className="size-4" />
      </Toolbar.Button>
      <Popover.Content align="start" className="grid w-72 gap-2 p-3">
        <Input
          aria-label={t("admin.pages.editor.link_url")}
          onChange={(event) => setHref(event.target.value)}
          // The popup is portalled outside the page's form, so Enter would
          // submit nothing; it applies the link instead.
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
          placeholder="https://"
          type="url"
          value={href}
        />
        <div className="flex justify-end gap-2">
          {active ? (
            <Button onClick={remove} size="sm" type="button" variant="ghost">
              {t("admin.pages.editor.link_remove")}
            </Button>
          ) : null}
          <Button onClick={apply} size="sm" type="button">
            {t("admin.pages.editor.link_apply")}
          </Button>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
};

const FormatToolbar = ({
  disabled,
  editor,
}: {
  disabled: boolean;
  editor: Editor | null;
}) => {
  const t = useClientMessages();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: Object.fromEntries(
        FORMAT_GROUPS.flatMap(({ formats }) =>
          formats.map((format) => [
            format.label,
            current ? format.isActive(current) : false,
          ])
        )
      ),
      link: current?.isActive("link") ?? false,
    }),
  });

  return (
    <Toolbar.Root
      aria-label={t("admin.pages.editor.toolbar")}
      className="flex flex-wrap items-center gap-1 border-b border-border p-1"
    >
      {FORMAT_GROUPS.map(({ formats, key }, groupIndex) => (
        <Fragment key={key}>
          {groupIndex > 0 ? (
            <Toolbar.Separator className="mx-1 h-5 w-px bg-border" />
          ) : null}
          <Toolbar.Group className="flex items-center gap-1">
            {formats.map((format) => {
              const Icon = format.icon;
              return (
                <Toolbar.Button
                  aria-label={t(format.label)}
                  aria-pressed={state?.active[format.label] ?? false}
                  className={TOOLBAR_BUTTON_CLASS_NAME}
                  disabled={disabled}
                  key={format.label}
                  onClick={() => {
                    if (editor) {
                      format.toggle(editor);
                    }
                  }}
                  title={t(format.label)}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </Toolbar.Button>
              );
            })}
            {key === "marks" ? (
              <LinkControl
                active={state?.link ?? false}
                disabled={disabled}
                editor={editor}
              />
            ) : null}
          </Toolbar.Group>
        </Fragment>
      ))}
    </Toolbar.Root>
  );
};

interface MarkdownEditorProps {
  "aria-label": string;
  /** Read once: remount the editor with a new `key` to start it over. */
  defaultValue: string;
  /** The form field the body is posted as, in Markdown. */
  name: string;
}

/**
 * A rich text editor over a Markdown body. The writer sees headings and lists
 * rather than their syntax, and the form still posts Markdown, which is what
 * the API stores and the storefront renders.
 *
 * The posted value is `defaultValue` itself until the writer changes
 * something, so a save that only touches other fields does not post the body
 * back reformatted as a change.
 *
 * It closes while its form is submitting, as the fieldset around it closes
 * every native control: the submission has already taken the body, and an edit
 * made during it would sit in the editor unsaved.
 */
export const MarkdownEditor = ({
  "aria-label": ariaLabel,
  defaultValue,
  name,
}: MarkdownEditorProps) => {
  const { pending } = useFormStatus();
  const [markdown, setMarkdown] = useState(defaultValue);
  const editor = useEditor({
    content: defaultValue,
    contentType: "markdown",
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        class: CONTENT_CLASS_NAME,
        role: "textbox",
      },
    },
    extensions: EXTENSIONS,
    // The server has no DOM to build the editor in.
    immediatelyRender: false,
    // The editor keeps an empty paragraph after a closing heading, table, or
    // code block for the caret to land in, and it carries nothing to the page.
    onUpdate: ({ editor: current }) =>
      setMarkdown(current.getMarkdown().trimEnd()),
  });

  // ProseMirror owns its `contenteditable`, so a disabled fieldset does not
  // reach it. The update is not emitted, which would reformat the posted body.
  useEffect(() => {
    editor?.setEditable(!pending, false);
  }, [editor, pending]);

  return (
    <div className="rounded-control border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
      <FormatToolbar disabled={!editor || pending} editor={editor} />
      <EditorContent className="min-h-72" editor={editor} />
      <input name={name} type="hidden" value={markdown} />
    </div>
  );
};
