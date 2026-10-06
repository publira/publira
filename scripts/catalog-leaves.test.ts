import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { namespaceLeaves, variableMismatches } from "./catalog-leaves.ts";

const locales = [{ code: "ja" }, { code: "en" }];

const leaves = (
  first: Record<string, unknown>,
  second: Record<string, unknown>
) =>
  namespaceLeaves(
    locales,
    new Map<string, unknown>([
      ["ja", { host: first }],
      ["en", { host: second }],
    ]),
    ["host"]
  );

describe("variableMismatches", () => {
  it("accepts translations that read the same variables however they use them", () => {
    assert.deepEqual(
      variableMismatches(
        leaves(
          { episodes: "Episodes: {$count :integer}", title: "{$name}" },
          {
            episodes:
              ".input {$count :integer}\n.match $count\none {{One episode}}\n* {{{$count} episodes}}",
            title: "{$name}",
          }
        )
      ),
      []
    );
  });

  it("names what each locale reads when one translation differs", () => {
    assert.deepEqual(
      variableMismatches(
        leaves(
          { footer: "From {$brnad}", home: "Top" },
          { footer: "Sent by {$brand}", home: "Home" }
        )
      ),
      ["host.footer: ja reads $brnad; en reads $brand"]
    );
  });

  it("reports a variable only some translations read", () => {
    assert.deepEqual(
      variableMismatches(
        leaves({ welcome: "Welcome" }, { welcome: "Welcome, {$name}" })
      ),
      ["host.welcome: ja reads nothing; en reads $name"]
    );
    assert.deepEqual(
      variableMismatches(
        leaves(
          { welcome: ".input {$name}\n{{Welcome}}" },
          { welcome: "Welcome, {$name}" }
        )
      ),
      []
    );
  });
});
