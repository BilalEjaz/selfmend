#!/usr/bin/env node
// README recipe sync check (the `check:readme` script).
//
// Enforces ROADMAP Phase 7 criterion 3's last mile: the README recipe code
// blocks must stay byte-identical to the compilable example files under
// examples/. Those files are the single source of truth (check:examples
// type-checks them against the published API); the README embeds them verbatim,
// and this gate fails if the two ever diverge, so a docs edit cannot silently
// break the documented code.
//
// For each recipe it locates the heading, then the next ```ts fenced block, and
// asserts the block content equals the corresponding examples/ file (after
// trimming a single trailing newline, since the file ends with one and the
// fenced block does not). On any mismatch or missing block it prints which
// recipe drifted and exits non-zero.
//
// Uses only Node builtins (node:fs, node:path), no new dependency.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Each recipe: the exact README heading and its source-of-truth example file.
const RECIPES = [
  { heading: "### Plain script", file: "examples/plain-script.ts" },
  { heading: "### Cucumber", file: "examples/cucumber.ts" },
  { heading: "### Mocha / Jest", file: "examples/mocha-jest.ts" },
];

const FENCE_OPEN = "\n```ts\n";
const FENCE_CLOSE = "\n```";

// Extract the first ```ts fenced block that appears after the given heading.
// Returns the block content (without the fence lines), or throws if the heading
// or its block is missing.
function extractBlock(readme, heading) {
  const headingAt = readme.indexOf(heading);
  if (headingAt < 0) {
    throw new Error(`README is missing the heading: ${heading}`);
  }
  const openAt = readme.indexOf(FENCE_OPEN, headingAt);
  if (openAt < 0) {
    throw new Error(`README has no \`\`\`ts block under heading: ${heading}`);
  }
  const start = openAt + FENCE_OPEN.length;
  const closeAt = readme.indexOf(FENCE_CLOSE, start);
  if (closeAt < 0) {
    throw new Error(`README \`\`\`ts block under ${heading} is never closed`);
  }
  return readme.slice(start, closeAt);
}

const readme = readFileSync(join(root, "README.md"), "utf8");

let drifted = 0;
for (const { heading, file } of RECIPES) {
  const block = extractBlock(readme, heading);
  // The example file ends with a single trailing newline the fenced block does
  // not carry; normalize that one newline before comparing.
  const source = readFileSync(join(root, file), "utf8").replace(/\n$/, "");
  if (block !== source) {
    drifted += 1;
    console.error(
      `DRIFT: the README block under "${heading}" no longer matches ${file}.`,
    );
    // Show the first differing character so the fix is obvious.
    const max = Math.max(block.length, source.length);
    for (let i = 0; i < max; i += 1) {
      if (block[i] !== source[i]) {
        console.error(
          `  first difference at index ${i}:\n` +
            `    README:   ${JSON.stringify(block.slice(i, i + 60))}\n` +
            `    ${file}: ${JSON.stringify(source.slice(i, i + 60))}`,
        );
        break;
      }
    }
  }
}

if (drifted > 0) {
  console.error(
    `\ncheck:readme failed: ${drifted} README recipe block(s) drifted from ` +
      `their examples/ source. The examples/ files are the source of truth; ` +
      `re-copy the file content into the README fenced block verbatim.`,
  );
  process.exit(1);
}

console.log("check:readme ok");
