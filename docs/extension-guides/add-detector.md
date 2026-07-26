# Add a detector

Detectors are browser-independent functions under
`packages/detectors/src/detectors`. Follow TDD and preserve the privacy
boundary.

## Required workflow

1. Add focused positive, negative, Unicode/boundary, malformed, overlap, and
   performance-regression tests. Dedicated sensitive samples belong only in
   `tests/fixtures/sensitive-values.json` or detector test files.
2. If introducing a category, update the closed catalogs in
   `packages/shared-types/src/findings.ts`: category, detector ID mapping, and
   fixed placeholder.
3. Implement a bounded detector returning exact UTF-16 `start`/`end` offsets and
   confidence. Use `createFinding` so IDs, `matchedText`, category, and
   placeholder are constructed consistently.
4. Export and invoke the detector from `packages/detectors/src/analyze.ts`.
5. Set deterministic overlap priority in `priority.ts`.
6. Define policy behavior explicitly. Do not let a new strict category inherit a
   configurable or permissive action accidentally.
7. Update sanitized display and audit category validation without exposing
   `matchedText`, offsets, or excerpts.
8. Add redaction, policy-boundary, runtime-validator, and artifact-fixture
   tests.

## Privacy rules

- A detector may inspect raw prompt text and produce `matchedText` transiently.
- Do not log, message, persist, render, or cache prompt-derived fields.
- Do not pass `SensitiveDataFinding` directly into the policy engine or React.
- The controller must explicitly convert to `PolicyFinding` and
  `DisplayFinding`; never spread a sensitive finding across a boundary.
- Placeholders are fixed category constants, not transformations of the match.

## Detection quality rules

- Bound every regex and loop for inputs up to 100,000 UTF-16 code units.
- Prefer conservative, explainable matches over broad fuzzy classification.
- Validate context and Unicode-aware boundaries where relevant.
- Reject invalid ranges and keep finding order stable.
- Add false-positive tests for nearby formats and ambiguous digit/text runs.
- Milestone 1 does not add remote lookups, AI models, entropy services, or
  network-backed reputation checks.

## Verification

Run the focused red test first, implement minimally, then run:

```bash
pnpm exec vitest run packages/detectors/src
pnpm --filter @ai-dlp/detectors typecheck
pnpm test:performance
pnpm test
pnpm build
pnpm verify:artifact
```

If a fixture value is added, `sensitive-fixture-isolation.test.ts` and the
production artifact verifier must both prove it is absent from production.
