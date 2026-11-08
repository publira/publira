import { describe, it } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import { designTokens, noJsxSvg } from "./oxlint-plugin.ts";

RuleTester.describe = describe;

RuleTester.it = it;

// Without `eslintCompat`, an expected `column` is zero-based.
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>';

describe("the publira oxlint plugin", () => {
  tester.run("no-jsx-svg", noJsxSvg, {
    invalid: [
      {
        code: `export const Badge = () => (\n  ${SVG}\n);`,
        errors: [{ line: 2, messageId: "svg" }],
      },
      {
        code: `export const Mark = () => <span>${SVG}</span>;`,
        errors: [{ messageId: "svg" }],
      },
    ],
    valid: [
      // Markup inside a string or a comment is not an element.
      `const allowed = '${SVG}';`,
      `// ${SVG}\nexport const Empty = () => null;`,
      // A component that happens to be named after the element is not one.
      "export const Logo = () => <Svg.Root />;",
    ],
  });

  tester.run("design-tokens", designTokens, {
    invalid: [
      {
        code: '<div className="rounded-2xl border shadow-sm" />;',
        errors: [
          { column: 16, data: { match: "rounded-2xl" }, messageId: "radius" },
          { column: 35, data: { match: "shadow-sm" }, messageId: "shadow" },
        ],
      },
      {
        code: '<div className="rounded-[1.75rem]" />;',
        errors: [{ data: { match: "rounded-[" }, messageId: "radius" }],
      },
      {
        code: '<p className="text-xs tracking-[0.2em] uppercase">Label</p>;',
        errors: [
          { column: 22, data: { match: "tracking-[" }, messageId: "tracking" },
          { column: 39, data: { match: "uppercase" }, messageId: "eyebrow" },
        ],
      },
      {
        // A class kept in a template literal or a constant is still a class.
        code: `const eyebrow = \`text-xs \${size} uppercase\`;`,
        errors: [
          { column: 33, data: { match: "uppercase" }, messageId: "eyebrow" },
        ],
      },
      {
        code: '<p className="font-mono text-xs">{id}</p>;',
        errors: [{ data: { match: "font-mono" }, messageId: "monospace" }],
      },
      {
        code: '<Table.Cell className="font-mono">{id}</Table.Cell>;',
        errors: [{ messageId: "monospace" }],
      },
      {
        // Written away from any element, nothing says the text is code.
        code: 'const mono = "font-mono";',
        errors: [{ messageId: "monospace" }],
      },
      {
        // Inside a `<pre>`, but on the `<span>`: the element the class is
        // written on is the one that decides.
        code: '<pre><span className="font-mono">{body}</span></pre>;',
        errors: [{ messageId: "monospace" }],
      },
      {
        code: '<div className="space-y-2">\n  <p className="uppercase">A</p>\n</div>;',
        errors: [{ column: 16, line: 2, messageId: "eyebrow" }],
      },
    ],
    valid: [
      '<div className="rounded-control rounded-surface shadow-floating" />;',
      // The face is what makes source readable, so the element decides: it is
      // allowed where the element says the text is code, however the class
      // reaches it.
      '<code className="font-mono">{id}</code>;',
      '<pre className="overflow-x-auto font-mono">{body}</pre>;',
      '<pre className={cn("font-mono", className)}>{body}</pre>;',
      `<code className={\`font-mono \${size}\`}>{body}</code>;`,
      // A comment that mentions a class does not use it.
      "// The store answers in uppercase, with rounded-[ and font-mono.\nexport {};",
      // A pattern is not a class either.
      "const upper = /uppercase/u;",
    ],
  });
});
