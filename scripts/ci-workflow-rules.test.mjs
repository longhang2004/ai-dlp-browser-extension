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
  assert.ok(
    workflow.includes(
      "REVIEWED_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}",
    ),
  );
  assert.ok(workflow.includes("ref: ${{ env.REVIEWED_COMMIT }}"));
  assert.ok(
    workflow.includes(
      "node scripts/canonical-dist-digest.mjs apps/extension/dist >",
    ),
  );
  assert.doesNotMatch(workflow, /pnpm artifact:digest >/u);
  assert.match(
    workflow,
    /name: ai-dlp-extension-\$\{\{ env\.REVIEWED_COMMIT \}\}\.sha256/u,
  );
  assert.match(
    workflow,
    /git archive --format=tar\.gz --output\s+ai-dlp-source-\$\{REVIEWED_COMMIT\}\.tar\.gz \$\{REVIEWED_COMMIT\}/u,
  );
  assert.match(
    workflow,
    /name: ai-dlp-source-\$\{\{ env\.REVIEWED_COMMIT \}\}\.tar\.gz/u,
  );
  assert.doesNotMatch(
    workflow,
    /name: ai-dlp-extension-\$\{\{ github\.sha \}\}/u,
  );
  assert.ok(workflow.includes("artifacts/playwright/**/trace.zip"));
  assert.doesNotMatch(workflow, /ai-dlp-playwright|sensitive-values\.json/u);
});

test("runs E2E and artifact checks before publishing any upload", () => {
  const finalE2eIndex = workflow.lastIndexOf("run: pnpm test:e2e");
  const verifyArtifactIndex = workflow.indexOf("run: pnpm verify:artifact");
  const artifactDigestIndex = workflow.indexOf(
    "node scripts/canonical-dist-digest.mjs apps/extension/dist >",
  );
  assert.notEqual(finalE2eIndex, -1, "missing final E2E step");
  assert.notEqual(verifyArtifactIndex, -1, "missing artifact verification");
  assert.notEqual(artifactDigestIndex, -1, "missing artifact digest");
  assert.ok(
    finalE2eIndex < verifyArtifactIndex,
    "final E2E must precede artifact verification",
  );
  assert.ok(
    finalE2eIndex < artifactDigestIndex,
    "final E2E must precede artifact digest",
  );

  const uploadSteps = [
    ...workflow.matchAll(/^\s+uses:\s+actions\/upload-artifact@/gmu),
  ].map(({ index }) => {
    const uploadIndex = index ?? -1;
    const nameStart = workflow.lastIndexOf("      - name: ", uploadIndex);
    const nameValueStart = nameStart + "      - name: ".length;
    const nameEnd = workflow.indexOf("\n", nameValueStart);
    return {
      index: uploadIndex,
      name: workflow.slice(nameValueStart, nameEnd),
    };
  });
  assert.ok(uploadSteps.length > 0, "missing artifact uploads");
  assert.ok(
    uploadSteps.some(
      ({ name }) => name === "Upload Playwright failure diagnostics",
    ),
    "missing Playwright diagnostics upload",
  );
  for (const { index: uploadIndex, name } of uploadSteps) {
    assert.ok(
      verifyArtifactIndex < uploadIndex,
      `${name}: artifact verification must precede upload`,
    );
    assert.ok(
      artifactDigestIndex < uploadIndex,
      `${name}: artifact digest must precede upload`,
    );
  }
});

function stepBlock(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

test("E2E failure diagnostics wait for final artifact checks", () => {
  const e2eFailureFixture = {
    failedStep: "Browser integration tests",
    finalChecks: [
      "Verify production artifact security",
      "Compute canonical extension digest",
    ],
    diagnostics: "Upload Playwright failure diagnostics",
  };
  const e2eIndex = workflow.indexOf(
    `      - name: ${e2eFailureFixture.failedStep}\n`,
  );
  const finalCheckIndexes = e2eFailureFixture.finalChecks.map((name) =>
    workflow.indexOf(`      - name: ${name}\n`),
  );
  const diagnosticsIndex = workflow.indexOf(
    `      - name: ${e2eFailureFixture.diagnostics}\n`,
  );
  assert.notEqual(e2eIndex, -1, "missing E2E step");
  for (const [index, name] of finalCheckIndexes.map((index, position) => [
    index,
    e2eFailureFixture.finalChecks[position],
  ])) {
    assert.notEqual(index, -1, `missing final check: ${name}`);
    assert.ok(e2eIndex < index, `${name} must follow the E2E step`);
  }
  assert.notEqual(diagnosticsIndex, -1, "missing diagnostics upload");
  assert.ok(
    finalCheckIndexes.every((index) => index < diagnosticsIndex),
    "diagnostics must follow both final checks",
  );

  for (const name of e2eFailureFixture.finalChecks) {
    assert.match(
      stepBlock(name),
      /\n\s+if:\s+always\(\)\n/u,
      `${name} must run after an earlier E2E failure`,
    );
  }
  assert.match(
    stepBlock(e2eFailureFixture.diagnostics),
    /\n\s+if:\s+failure\(\)\n/u,
    "diagnostics must wait for final checks while preserving failure output",
  );
});
