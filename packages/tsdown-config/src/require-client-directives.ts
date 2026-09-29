import { readFile } from "node:fs/promises";
import path from "node:path";

/** `"use client"` as the first statement, after any leading comments. */
const USE_CLIENT = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*["']use client["']/u;

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

interface PluginContext {
  error: (message: string) => never;
}

const startsWithUseClient = async (id: string): Promise<boolean> => {
  if (!path.isAbsolute(id) || id.includes("/node_modules/")) {
    return false;
  }
  try {
    return USE_CLIENT.test(await readFile(id, "utf-8"));
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
    _options: unknown,
    bundle: Record<string, OutputAsset | OutputChunk>
  ) {
    const candidates: { fileName: string; id: string }[] = [];
    for (const output of Object.values(bundle)) {
      if (
        output.type === "chunk" &&
        !DECLARATION_FILE.test(output.fileName) &&
        !USE_CLIENT.test(output.code)
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
