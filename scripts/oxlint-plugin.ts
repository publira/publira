/**
 * The repository's own oxlint rules, loaded by `oxlint.config.ts` as the
 * `publira` plugin, so `pnpm check` runs them beside every other rule and an
 * editor with the oxc extension reports them as they are typed.
 *
 * Both read the AST rather than the text: markup inside a string or a comment
 * is not an element, and a comment that mentions a class does not use it.
 */

import type { Context, ESTree, Node } from "@oxlint/plugins";
import { definePlugin, defineRule } from "@oxlint/plugins";

/**
 * Icons come from `@publira/icons`, and `packages/icons` is the only place a
 * raw `<svg>` normally lives. A hand-written one elsewhere draws an icon the
 * set does not know about, at a stroke and a size the set does not hold it to,
 * and `no-restricted-imports` cannot see it: the `lucide-react` import it
 * refuses is not there to refuse.
 *
 * The places allowed one are `oxlint.config.ts` overrides, each with the
 * reason nothing in the icon set will do.
 */
export const noJsxSvg = defineRule({
  create: (context) => ({
    JSXOpeningElement: (node) => {
      if (node.name.type === "JSXIdentifier" && node.name.name === "svg") {
        context.report({ messageId: "svg", node });
      }
    },
  }),
  meta: {
    docs: {
      description:
        "Disallow an `<svg>` element in JSX outside the icon set and its documented exceptions.",
    },
    messages: {
      svg: "Use an icon from @publira/icons instead of writing <svg> in JSX. See apps/AGENTS.md.",
    },
    type: "problem",
  },
});

const REPLACED = "`{{match}}` is not a class this design uses.";

/** Why each class is gone, and what stands in for it. */
const MESSAGES = {
  eyebrow: `${REPLACED} The brief has no all-caps eyebrow: a label appears only when the content underneath needs the distinction, and it is set in sentence case.`,
  monospace: `${REPLACED} The console has one typeface for its data. \`font-mono\` belongs on a \`<code>\` or \`<pre>\` element; an identifier is set in the sans face with \`tabular-nums\`, beside a copy control where the exact value matters (\`Identifier\` in @publira/ui-components).`,
  radius: `${REPLACED} Two radii only: \`rounded-control\` for inputs, buttons and chips, \`rounded-surface\` for artwork and floating layers. An in-flow surface such as a card or a table has none.`,
  shadow: `${REPLACED} One shadow, on floating layers only: \`shadow-floating\`. An in-flow surface is separated from the page by a hairline or by a step from \`background\` to \`card\`.`,
  tracking: `${REPLACED} Letter-spacing is the type scale's decision, not a screen's. Drop the tracking rather than tuning it per screen.`,
};

interface Banned {
  messageId: keyof typeof MESSAGES;
  pattern: RegExp;
}

const BANNED: Banned[] = [
  { messageId: "radius", pattern: /\brounded-(?:2xl|3xl|\[)/gu },
  { messageId: "shadow", pattern: /\bshadow-(?:sm|md|lg|xl|2xl)\b/gu },
  { messageId: "eyebrow", pattern: /\buppercase\b/gu },
  { messageId: "tracking", pattern: /\btracking-\[/gu },
];

const MONOSPACE: Banned = {
  messageId: "monospace",
  pattern: /\bfont-mono\b/gu,
};

/** The elements whose content is code, and may therefore be set in that face. */
const CODE_ELEMENTS = new Set(["code", "pre"]);

/**
 * Whether {@link node} is part of the attributes of a `<code>` or `<pre>`
 * element: written into its `className` directly, through `cn()`, or through a
 * template literal.
 *
 * The walk stops at the first element it meets. An opening element is the one
 * the class is written on; a whole element or a fragment means the text sits in
 * some element's children instead, where it styles nothing.
 */
const isOnCodeElement = (node: Node): boolean => {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "JSXOpeningElement") {
      return (
        current.name.type === "JSXIdentifier" &&
        CODE_ELEMENTS.has(current.name.name)
      );
    }

    if (current.type === "JSXElement" || current.type === "JSXFragment") {
      return false;
    }
  }

  return false;
};

const isStringLiteral = (node: ESTree.Literal): node is ESTree.StringLiteral =>
  typeof node.value === "string";

/**
 * Reports every match of {@link banned} in the source text of {@link node}, at
 * the class itself rather than the whole string, so a long `className` points
 * at the word to change.
 */
const reportMatches = (context: Context, node: Node, banned: Banned): void => {
  const { sourceCode } = context;

  for (const match of sourceCode.getText(node).matchAll(banned.pattern)) {
    const start = node.start + match.index;

    context.report({
      data: { match: match[0] },
      loc: {
        end: sourceCode.getLocFromIndex(start + match[0].length),
        start: sourceCode.getLocFromIndex(start),
      },
      messageId: banned.messageId,
    });
  }
};

const inspect = (context: Context, node: Node): void => {
  for (const banned of BANNED) {
    reportMatches(context, node, banned);
  }

  if (!isOnCodeElement(node)) {
    reportMatches(context, node, MONOSPACE);
  }
};

/**
 * Fail on the utility classes the design brief replaced.
 *
 * The brief pins two radii (`rounded-control`, `rounded-surface`) and one
 * shadow (`shadow-floating`), and it rejects the tracked-out all-caps eyebrow
 * and the monospace face for small data outright. Every one of those is a class
 * a screen can reach for again in a single line, and none of them is a mistake
 * a reviewer reliably catches: the markup looks fine on its own, and only the
 * screen standing next to it says otherwise. So the classes themselves are what
 * this checks, in every string and template literal.
 *
 * `font-mono` is the one with an allowance rather than a ban. A console has one
 * typeface for its data — an identifier is set in the sans face with tabular
 * figures, and a copy control is what gives an operator the exact value — but
 * source code is genuinely a different kind of text, and the face is what makes
 * it readable. So the face is allowed where the element says it is code, and
 * refused everywhere else.
 */
export const designTokens = defineRule({
  create: (context) => ({
    Literal: (node) => {
      if (isStringLiteral(node)) {
        inspect(context, node);
      }
    },
    TemplateElement: (node) => {
      inspect(context, node);
    },
  }),
  meta: {
    docs: {
      description:
        "Disallow the radius, shadow, letter-spacing, case, and face utility classes the design brief replaced.",
    },
    messages: MESSAGES,
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "publira" },
  rules: {
    "design-tokens": designTokens,
    "no-jsx-svg": noJsxSvg,
  },
});
