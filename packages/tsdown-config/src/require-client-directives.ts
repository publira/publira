import { readFile } from "node:fs/promises";
import path from "node:path";

/** One run of whitespace or one comment, read from `lastIndex`. */
const LEADING_TRIVIA = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\//uy;

const USE_CLIENT = /["']use client["']/uy;

/**
 * Whether `"use client"` is the first statement, after any leading comments.
 * The comments are skipped one at a time: a single pattern repeating a choice
 * of comment forms can split the same text into comments in many ways, and
 * backtracks through all of them on a source that has no directive.
 */
const hasUseClient = (source: string): boolean => {
  let offset = 0;
  LEADING_TRIVIA.lastIndex = 0;

  while (LEADING_TRIVIA.test(source)) {
    offset = LEADING_TRIVIA.lastIndex;
  }

  USE_CLIENT.lastIndex = offset;

  return USE_CLIENT.test(source);
};

const DECLARATION_FILE = /\.d\.[cm]?ts$/u;

interface OutputChunk {
  code: string;
  fileName: string;
  moduleIds: readonly string[];
  type: "chunk";
}

interface OutputAsset {
  type: "asset";
}

/** rolldown's normalized output options; the plugin reads none of them. */
interface NormalizedOutputOptions {
  readonly dir?: string;
}

interface PluginContext {
  error: (message: string) => never;
}

const startsWithUseClient = async (id: string): Promise<boolean> => {
  if (!path.isAbsolute(id) || id.includes("/node_modules/")) {
    return false;
  }

  try {
    return hasUseClient(await readFile(id, "utf-8"));
  } catch {
    return false;
  }
};

/**
 * Fails the build when an emitted chunk holds a module whose source starts with
 * `"use client"` but the chunk itself does not: rolldown drops the directive
 * from a module it merges into a chunk, and Next.js then evaluates that module
 * in the server graph.
 */
export const requireClientDirectives = () => ({
  async generateBundle(
    this: PluginContext,
    _options: NormalizedOutputOptions,
    bundle: Record<string, OutputAsset | OutputChunk>
  ) {
    const candidates: { fileName: string; id: string }[] = [];

    for (const output of Object.values(bundle)) {
      if (
        output.type === "chunk" &&
        !DECLARATION_FILE.test(output.fileName) &&
        !hasUseClient(output.code)
      ) {
        for (const id of output.moduleIds) {
          candidates.push({ fileName: output.fileName, id });
        }
      }
    }

    const marked = await Promise.all(
      candidates.map(({ id }) => startsWithUseClient(id))
    );

    const dropped: string[] = [];

    for (const [index, { fileName, id }] of candidates.entries()) {
      if (marked[index]) {
        dropped.push(`${id} -> ${fileName}`);
      }
    }

    if (dropped.length > 0) {
      this.error(
        `"use client" was dropped from ${dropped.length} module(s):\n${dropped.join("\n")}`
      );
    }
  },
  name: "publira:require-client-directives",
});
