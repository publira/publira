import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findInFile } from "./check-design-tokens.ts";

const matches = (source: string): string[] =>
  findInFile("example.tsx", source).map((finding) => finding.match);

describe("findInFile", () => {
  it("reports the radii and the shadows the design replaced", () => {
    assert.deepEqual(
      matches('<div className="rounded-2xl border shadow-sm" />'),
      ["rounded-2xl", "shadow-sm"]
    );
    assert.deepEqual(matches('<div className="rounded-[1.75rem]" />'), [
      "rounded-[",
    ]);
  });

  it("reports an all-caps eyebrow and per-screen letter-spacing", () => {
    assert.deepEqual(
      matches('<p className="text-xs tracking-[0.2em] uppercase">Label</p>'),
      ["uppercase", "tracking-["]
    );
  });

  it("leaves the two radii and the one shadow alone", () => {
    assert.deepEqual(
      matches(
        '<div className="rounded-control rounded-surface shadow-floating" />'
      ),
      []
    );
  });

  // The face is what makes source readable, so the element decides: it is
  // allowed where the element says the text is code.
  it("allows the monospace face on a code or pre element", () => {
    assert.deepEqual(matches('<code className="font-mono">{id}</code>'), []);
    assert.deepEqual(
      matches('<pre className="overflow-x-auto font-mono">{body}</pre>'),
      []
    );
  });

  it("reports the monospace face anywhere else", () => {
    assert.deepEqual(matches('<p className="font-mono text-xs">{id}</p>'), [
      "font-mono",
    ]);
    assert.deepEqual(
      matches('<TableCell className="font-mono">{id}</TableCell>'),
      ["font-mono"]
    );
  });

  it("names the file and the line a finding sits on", () => {
    const [finding] = findInFile(
      "apps/web-admin/example.tsx",
      [
        '<div className="p-4">',
        '  <p className="uppercase">A</p>',
        "</div>",
      ].join("\n")
    );

    assert.equal(finding?.file, "apps/web-admin/example.tsx");
    assert.equal(finding?.line, 2);
  });
});
