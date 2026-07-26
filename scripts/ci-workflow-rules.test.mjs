import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

test("pins a least-privilege clean CI gate with all security checks", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.doesNotMatch(workflow, /uses:\s+[^@\n]+@v\d/u);
  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:performance",
    "pnpm build",
    "pnpm verify:artifact",
    "pnpm test:e2e",
  ]) {
    assert.ok(workflow.includes(command), `missing CI command: ${command}`);
  }
  assert.ok(workflow.includes("rm -rf apps/extension/dist"));
  assert.ok(workflow.includes("artifacts/playwright/**/trace.zip"));
  assert.doesNotMatch(workflow, /ai-dlp-playwright|sensitive-values\.json/u);
});
