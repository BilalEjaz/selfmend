---
phase: 03-persistence-parallel-worker-safety
reviewed: 2026-05-31T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - src/store/schema.ts
  - src/store/serialize.ts
  - src/store/merge.ts
  - src/store/persistence.ts
  - src/store/store.ts
  - src/integration/locator-proxy.ts
  - src/integration/fixture.ts
  - src/integration/events.ts
  - src/reporter/reporter.ts
findings:
  blocker: 0
  warning: 4
  info: 5
  total: 9
resolution:
  fixed:
    - WR-01
    - IN-02
  accepted:
    - WR-02
    - WR-03
    - WR-04
    - IN-01
    - IN-03
    - IN-04
    - IN-05
status: clean
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-31
**Depth:** deep
**Files Reviewed:** 9
**Status:** clean (WR-01 + IN-02 fixed; remaining warnings/info accepted-for-now — see Resolution)

> **Resolution (2026-05-31):** WR-01 (prune positional-file gap, trust property
> D-09) and IN-02 (duplicate `describeArgs` collision class) were FIXED with
> failing-test-first commits. WR-02, WR-03, WR-04 and all INFO findings are
> ACCEPTED for Phase 3 as documented known limitations (none is a false-green or
> destructive-on-default-path risk). See the **Resolution & Accepted
> Limitations** section at the end for per-finding rationale.

## Summary

Phase 3 (Persistence & Parallel-Worker Safety) is well-engineered and conservative where it matters most. The prune-safety design is genuinely defense-in-depth: prune is a separate pure function with no completeness flag, gated at the call site behind `isComplete AND passed AND SELFMEND_PRUNE`, with the default being non-destructive (refresh-only). The purity boundary holds (schema/serialize/merge import only types from schema/matching, no `node:fs`, no Playwright). The atomic write is correct (temp on same dir/volume, retry with backoff, temp cleanup + rethrow on exhaustion). Schema safe-parse is sound and the strict fingerprint object genuinely blocks raw-DOM leaks.

I found **no BLOCKER** issues. The destructive-prune path I was asked to scrutinize hardest is safe by construction. The findings below are correctness/robustness concerns worth fixing before Phase 4 publish, none of which can produce a false-green test or silently delete a valid baseline on a normal (non-`SELFMEND_PRUNE`) run.

The most important real finding is **WR-01**: a documented prune-gate gap. `isComplete` does not cover `--repeat-each`, `testIgnore`/`testMatch` config-level narrowing, or a positional file-path/line argument that does not start with `--`. The single-file/path-arg case is explicitly claimed covered in the `NARROWING_CLI_FLAGS` doc comment but is NOT actually detected by `argvNarrowsRun` (it only matches flags starting with `-`). On a `SELFMEND_PRUNE=1 npx playwright test tests/login.spec.ts` run that passes, this would prune every baseline outside that file. This is gated behind the explicit opt-in, so it is a WARNING not a blocker, but the doc comment is actively misleading.

## Warnings

### WR-01: `argvNarrowsRun` does not detect a positional file/path argument, contradicting its own doc comment

**File:** `src/reporter/reporter.ts:438-467`
**Issue:** The `NARROWING_CLI_FLAGS` doc comment (lines 438-447) explicitly claims "single-file" runs are detected as narrowing. They are not. `argvNarrowsRun` only matches argv tokens that are exactly a known flag or `startsWith(`${flag}=`)`. A positional path argument like `tests/login.spec.ts` or `tests/login.spec.ts:42` is a bare token that matches none of those, so `argvNarrowsRun` returns `false` and `isComplete` returns `true`. On `SELFMEND_PRUNE=1 npx playwright test tests/login.spec.ts` that passes, `shouldPrune` returns `true` and `prune(next, merged.seen)` deletes every baseline key whose locator was not exercised by that one file — i.e. the entire rest of the suite's baselines. The prune review brief lists "single-file path arg" as a narrowing mechanism to cover; it is documented as covered but is not.

Note this is gated behind the explicit `SELFMEND_PRUNE` opt-in, so the default path is safe. But a user who adopts `SELFMEND_PRUNE` in a script and occasionally runs a single file (or whom CI runs with a path filter) will silently lose baselines.

**Fix:** Detect any positional (non-flag, non-flag-value) argv token after the `playwright test` subcommand as a narrowing path filter, OR cross-check `plannedTestCount` (already captured in `onBegin`) against the suite's full unfiltered count. The simplest robust gate: treat the run as narrowed if any argv token after the runner entry does not start with `-` and is not the value of a known value-flag. Conservative pseudocode:

```ts
function argvHasPositionalFilter(argv: readonly string[]): boolean {
  // skip node + script path (first 2), then look for a bare token that is
  // not a flag and not consumed as a flag's value.
  const VALUE_FLAGS = new Set(["--grep", "-g", "--grep-invert", "--shard", "--project", "--workers", "--retries", "--reporter", "--config", "-c", "--timeout", "--repeat-each", "--max-failures"]);
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("-")) {
      if (VALUE_FLAGS.has(tok)) i++; // skip its space-separated value
      continue;
    }
    if (tok === "test") continue; // the subcommand
    return true; // a bare positional => path/title filter => narrowed
  }
  return false;
}
```
Then OR this into `argvNarrowsRun`. Alternatively (more robust against argv parsing drift), compare `suite.allTests().length` captured in `onBegin` against an independently-computed full count, but that requires re-listing — the argv positional check is the cheaper fix and matches the existing approach.

### WR-02: `--repeat-each` and `--max-failures` are not treated as narrowing; `testMatch`/`testIgnore` config filters are invisible to `isComplete`

**File:** `src/reporter/reporter.ts:449-493`
**Issue:** Two related gaps in the completeness predicate, both behind the `SELFMEND_PRUNE` opt-in:
1. `--max-failures N` (and `-x`) aborts the run early once N failures accumulate. Such a run can report `status: "passed"`? No — it reports failed/interrupted on hitting the cap, so `shouldPrune` would correctly bail on status. But a run that passes under `--max-failures` simply never hit the cap, so it is genuinely complete; this one is fine. `--repeat-each N` is different: it does not narrow which tests run, it multiplies them, so completeness is preserved. Neither of these is actually a prune-safety hole — flagging here for the record so a future maintainer does not "fix" them and over-restrict.
2. The real gap: `testMatch` / `testIgnore` set in `playwright.config.ts` narrow the discovered test set at config level. `FullConfig.grep`/`grepInvert`/`shard` do NOT reflect them, and they leave no argv trace. `isComplete` therefore returns `true` for a config that permanently excludes part of the suite, and a passing `SELFMEND_PRUNE` run would prune baselines for the excluded tests. This is arguably "working as intended" (those tests are excluded by project policy, so their baselines are dead), but it is not documented as a known prune behavior.

**Fix:** Document explicitly in the `isComplete`/`shouldPrune` doc comments that `testMatch`/`testIgnore` config-level exclusions are treated as the project's intended full suite (so their baselines are pruned), and that `--repeat-each` preserves completeness. If pruning excluded-test baselines is undesirable, the only robust signal is comparing `plannedTestCount` against project-config-derived totals — out of scope for an advisory fix, but the doc comment currently implies grep/grepInvert/shard are the complete set of narrowing vectors, which is false.

### WR-03: Chain re-wrap re-invokes `nextOccurrence` on every chained-method call, making the occurrence counter sensitive to how many times a chain is *invoked*, not how many distinct locators exist

**File:** `src/integration/locator-proxy.ts:217-242` (CHAIN trap) + `194-215` (per-wrap occurrence stamp)
**Issue:** Every CHAIN method call (`first()`, `nth()`, `locator()`, `filter()`, `getByRole()`, ...) builds a fresh `chainedSelector` and calls `wrapLocator(next, chainedSelector, ctx)`, which at line 208 calls `ctx.nextOccurrence(contentKey)` for the chained content key. The occurrence index is therefore "the Nth *creation* of this content within the test." A test that creates the same chained locator twice (e.g. `page.locator('.row').first().click()` in two places, or a chained locator built inside a loop) consumes two distinct occurrence indices and thus two distinct baseline keys. That is the intended D-05 semantics on the capture run — but the heal run must reproduce the EXACT same creation sequence to land on the same key. Re-wrapping is triggered by *calling* the chain method, so if the heal run takes a different code path (e.g. a conditional that only fires when the element is broken, an early-return on the capture run that does not happen on the broken run, or a retry that re-invokes the chain), the occurrence counts diverge and the broken locator's key will not match its captured fingerprint. Per D-07 a missing key fails safe (no heal, re-throw original), so this is NOT a false-green risk — but it silently reduces heal hit-rate exactly in the dynamic-locator cases healing is most wanted for.

Additionally, `describeArgs` consumes occurrence indices for non-serializable args from the SAME per-test `nextOccurrence` map (line 287). A `dragTo(targetLocator)` or `filter({ has: locator })` chain folds a `<object#N>` token whose `N` advances per call. The same divergence applies, and it interleaves with the main occurrence counter's pseudo-key namespace (mitigated by the `\u0000describeArgs:` prefix, which is correct — no collision with real content keys).

**Fix:** This is inherent to occurrence-by-creation-order and is acceptable for v1 given the fail-safe. Recommend: (a) document the cross-run-stability precondition prominently — "identical locator-creation order between capture and heal runs is required for a key to match; divergent control flow degrades to no-heal, never mis-heal"; (b) consider counting occurrence by (content key) at first-resolution rather than at creation if a future phase wants resilience to creation-order churn. No code change required for correctness now.

### WR-04: `withTimeout` mis-handles `selectOption(values, options?)` and any action whose trailing positional arg is itself a plain object payload

**File:** `src/integration/locator-proxy.ts:178-184`
**Issue:** `withTimeout` treats the LAST positional arg as an options bag if it is a plain object. For `selectOption`, a valid call is `selectOption({ label: 'Blue' })` — a single plain-object *value*, not an options bag. On replay, `withTimeout([{label:'Blue'}], replayMs)` spreads it to `{ label: 'Blue', timeout: replayMs }`, which Playwright happens to tolerate (extra `timeout` key on a select value is ignored), so this specific case is benign. But the more general hazard: `setInputFiles` accepts `{ name, mimeType, buffer }` payload objects as the value; `selectOption([{value:'x'}], {timeout})` passes an array then options (handled correctly). The risk is a value-object being mutated with a `timeout` field. This only affects the REPLAY path (heal already triggered), and Playwright ignores unknown keys, so no observed break — but it is a latent correctness trap: an action could legitimately reject an extra `timeout` key, or a future payload object could collide on `timeout`.

**Fix:** Gate the options-bag detection on method identity. Only `click/fill/hover/...` take a trailing options object; `selectOption`/`setInputFiles` value shapes should not be treated as options. Pass `method` into `withTimeout` and skip the merge for value-payload methods, appending `{timeout}` as a separate trailing arg only where the action's signature accepts it. Minimum: add a `KNOWN_NO_TRAILING_OPTIONS_MERGE = new Set(["selectOption","setInputFiles"])` guard. Low severity because it is replay-only and currently tolerated, but worth hardening for publish.

## Info

### IN-01: Object-prototype-pollution-shaped keys flow unsanitized into `Record` literals (no actual exploit, but defensive gap)

**File:** `src/store/merge.ts:60-81`, `src/store/store.ts:43-49`, `src/store/serialize.ts:60-67`
**Issue:** `mergeShards` does `captures[key] = incoming` and `refresh` does `{...baseline.entries, ...merged.captures}` where `key` is an attacker-influenceable string from a hand-edited/shared `baseline.json` (the file is explicitly meant to be committed and human-edited). A key of `__proto__` written into a JSON object literal via `obj[key] =` does NOT pollute the prototype in modern V8 (assignment to `__proto__` via computed property on a plain object sets an own property only when the object has no `__proto__` accessor — and `{}` does), but `Object.fromEntries` and spread also create own properties. The zod `z.record(z.string(), ...)` does not reject `__proto__`/`constructor`/`prototype` keys. There is no proven pollution here (computed assignment and `Object.fromEntries` create own props, not prototype writes), and the values are validated fingerprints, so this is informational. Still, a trust-first tool reading a shared file should be explicit.

**Fix:** Either use a `Map`/null-prototype object for the entries store, or filter `__proto__`/`constructor`/`prototype` keys in `parseBaseline`/`parseShard` after safe-parse. Documenting "keys are own-property assignments, prototype is never written" in the schema would also suffice.

### IN-02: `fixture.ts` `describeArgs` swallows `JSON.stringify` of non-serializable args to `""`, re-introducing the collision class `locator-proxy.describeArgs` was explicitly hardened against

**File:** `src/integration/fixture.ts:59-67`
**Issue:** The page-level `describeArgs` (distinct from the proxy-level one) maps a non-string arg via `JSON.stringify(a) ?? ""`. For a non-serializable factory arg (a `RegExp` passed to `getByRole(role, { name: /.../ })`, which JSON-stringifies the options object fine, but a circular/function value would yield `undefined` -> `""`), two genuinely different factory calls collapse to the same selector string and thus the same baseline key. The proxy-level `describeArgs` (locator-proxy.ts:268-290) was deliberately rewritten to fold a distinguishing `<typeof#N>` token for exactly this reason (cited as "the CR-01 collision class"). The page-factory version did not get the same treatment. In practice page factories rarely take non-serializable args (`getByRole`'s options serialize; `locator(selector, {has})` can take a `Locator`), so the exposure is narrow, but `locator('.x', { has: page.locator('.y') })` would stringify `{has: <Locator>}` — `JSON.stringify` of a Locator yields `{}` or throws, collapsing distinct `has` filters together.

**Fix:** Reuse the hardened proxy `describeArgs` (export it, already exported) in `fixture.ts` instead of the local weaker copy, threading a per-test `nextOccurrence`. Same fail-safe applies (collision -> wrong-fingerprint match is still floor+margin gated downstream), so this is INFO not WARNING, but the divergence between two `describeArgs` implementations is a maintenance hazard and a known collision class left open on one side.

### IN-03: `loadBaseline` is called twice per run for the committed file (worker setup + reporter onEnd) — harmless, but the reporter re-reads instead of reusing the merge input

**File:** `src/reporter/reporter.ts:152` and `src/integration/fixture.ts:123`
**Issue:** Not a bug. Noting that `mergeAndPersist` calls `loadBaseline(this.rootDir)` to get the existing committed baseline, then `refresh`es the merged shards over it. This is correct (refresh must layer over the prior committed file). The double-read across workers + reporter is fine because they run at different times. No action needed; recorded for completeness of the read/write ordering audit. The race the brief asks about (worker shard write in teardown vs reporter onEnd read) is NOT present: Playwright runs all worker teardowns before the reporter's `onEnd`, so `readShards` in `onEnd` sees all flushed shards. Verified safe.

### IN-04: `shardPath` uses `parallelIndex` for uniqueness — correct, but a restarted worker with a NEW parallelIndex after a crash could orphan a shard

**File:** `src/integration/fixture.ts:120-130`, `src/store/persistence.ts:78-84`
**Issue:** `parallelIndex` is unique among *concurrently running* workers (Playwright guarantees `0..workers-1` with no two live workers sharing one), so two live workers never collide on `shard-<n>.json` — the CAP-03 no-lost-write property holds. The overwrite-on-restart-of-same-index is intended (D-13 merge is order-independent and last-writer-per-index is fine because a restarted worker re-runs the same tests). One edge: if a worker crashes mid-teardown after `writeShard` began but before it completed, `writeShard` uses a plain (non-atomic) `writeFile` (persistence.ts:113-116), so a crash could leave a truncated `shard-<n>.json`. `readShards` -> `JSON.parse` would throw, caught, and `parseShard(undefined)` returns EMPTY — so that worker's captures are silently dropped from the merge, but the run is not corrupted and no valid baseline is deleted (refresh layers over prior committed file; prune only runs on a fully-passed complete run where all workers flushed cleanly). Fail-soft holds. Recorded as a known, acceptable degradation, not a defect.

**Fix:** None required for v1. If shard durability ever matters, make `writeShard` atomic too (temp+rename), but the brief correctly scoped shards as transient.

### IN-05: `parseBaseline`/`parseShard` redundant spread of already-canonical EMPTY constants

**File:** `src/store/schema.ts:103` and `:118`
**Issue:** `return { ...EMPTY_BASELINE, entries: {} }` spreads the constant then overwrites `entries` with a fresh `{}`. The intent (return a fresh object so callers cannot mutate the shared EMPTY constant) is good, but the spread already copies `version`, and `entries: {}` is redundant with `EMPTY_BASELINE.entries` only if you want a *fresh* inner object — which you do, since the spread is shallow and would otherwise share the `EMPTY_BASELINE.entries` reference. So the code is actually correct and the `entries: {}` is load-bearing (prevents shared-reference mutation). Minor: a comment would prevent a future "simplify" that drops it and introduces shared-mutable-state. No behavior change needed.

**Fix:** Add a one-line comment: `// fresh entries object: shallow spread would otherwise share EMPTY_BASELINE.entries`.

---

## Focus-area verdicts (brief)

1. **Prune safety (CRITICAL focus):** SAFE by construction. Default (no `SELFMEND_PRUNE`) is non-destructive. Gate is `complete AND passed AND opt-in`. Refresh never drops keys (only adds/overwrites). The one real gap is **WR-01** (positional file-path arg not detected, contradicting the doc comment) and **WR-02** (config `testMatch`/`testIgnore`), both behind the opt-in. No unconditional destructive path. No BLOCKER.
2. **Parallel correctness (CAP-03):** SAFE. `parallelIndex` is unique among live workers; merge is order-independent (value-derived tie-break, set-union seen); no worker writes `baseline.json`; reporter is single writer; teardown-before-onEnd ordering eliminates the read/write race (IN-03, IN-04).
3. **Windows atomic write:** CORRECT. Temp in same dir (no EXDEV), retry on EPERM/EBUSY/EACCES with linear backoff, temp cleanup + rethrow on exhaustion (no silent data loss, no half-written target), `mkdir recursive` is race-safe (idempotent, no throw on existing).
4. **Cross-run identity (CAP-02):** Key is computed at creation time per (testFile, titlePath, selector, occurrence), reset per test. Stable when locator-creation order is identical across runs; degrades to fail-safe no-heal otherwise (**WR-03**). Missing key -> no heal (D-07) verified at locator-proxy.ts:357-358.
5. **Schema/version (D-10):** SAFE. Unknown/old version or malformed file -> EMPTY via `z.literal` + `safeParse`, never throws. `strictObject` genuinely rejects unknown keys (innerHTML/outerHTML/innerText) — verified raw-DOM cannot enter the committed file.
6. **Purity:** HOLDS. schema/serialize/merge import only types from `./schema.js` and `../matching/types.js`; no `node:fs`, no `@playwright/test`. fs confined to persistence.ts (verified imports).
7. **General correctness / regression:** No false-green path introduced. `attachHealEvent`/`attachRefusedEvent` are best-effort and never suppress the original throw. Phase 1/2 heal-loop semantics preserved.

---

_Reviewed: 2026-05-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Resolution & Accepted Limitations (2026-05-31)

Two findings were FIXED (TDD: failing test committed first, then fix). The rest
are ACCEPTED for Phase 3 as documented known limitations — none can produce a
false-green test or delete a valid baseline on a default (non-`SELFMEND_PRUNE`)
run.

### Fixed

- **WR-01 — FIXED.** `argvHasPositionalFilter` now treats a bare positional
  argv token after the `playwright test` subcommand (e.g. `tests/login.spec.ts`,
  `tests/login.spec.ts:42`, a title substring) as a run-narrowing path/title
  filter, OR-ed into `argvNarrowsRun`. The value of a known value-flag
  (`--workers 4`, `--reporter list`, ...) is correctly skipped, so a plain
  `--workers N` run stays complete. The misleading `NARROWING_CLI_FLAGS` doc
  comment that claimed single-file runs were covered there was corrected. A
  `SELFMEND_PRUNE=1 npx playwright test tests/login.spec.ts` run is now
  classified NOT complete and never prunes. (`src/reporter/reporter.ts`;
  failing test in `src/reporter/reporter.test.ts`.)

- **IN-02 — FIXED.** The weaker page-level `describeArgs` in `fixture.ts` was
  removed; `fixture.ts` now imports and uses the single hardened
  `describeArgs` from `locator-proxy.ts` (which folds a distinguishing
  `<typeof#N>` token for non-serializable args), threading the per-test
  `nextOccurrence` through `wrapPage`. Both the page-factory and chain paths now
  use the collision-safe implementation. (`src/integration/fixture.ts`; failing
  test in `src/integration/page-args.test.ts`.)

### Accepted for Phase 3 (documented, no code change)

- **WR-03 — ACCEPTED.** The occurrence key is re-derived on every chained-method
  call (`nextOccurrence` runs per CHAIN re-wrap), so the index counts chain
  *invocations*, not distinct locators. Divergent control flow between a capture
  run and a later heal run (a conditional that only fires when broken, a retry
  that re-invokes the chain, an early return) can shift occurrence indices and
  the broken locator's key may not match its captured fingerprint. **This is
  fail-safe, not a false green:** per D-07 a missing key means no heal and the
  original error re-throws — the worst case is a reduced cross-run heal hit-rate
  in dynamic-locator cases, never a mis-heal. Accepted for Phase 3. Candidate
  for a dedicated later-phase fix: key occurrence only at the terminal action,
  or adopt a chain-stable locator identity, so creation-order churn no longer
  degrades the hit-rate.

- **WR-04 — ACCEPTED.** `withTimeout` treats a trailing plain object as an
  options bag, so a `selectOption({ label: 'Blue' })` / `setInputFiles({ name,
  mimeType, buffer })` value-object payload gets a `timeout` key merged in on the
  REPLAY path. Playwright currently tolerates the extra key (it is ignored), so
  this is a latent correctness trap, not an observed break, and it only affects
  the replay path after a heal has already triggered. Accepted for Phase 3.
  Candidate hardening for publish: gate options-bag merging on method identity
  (`KNOWN_NO_TRAILING_OPTIONS_MERGE = new Set(["selectOption","setInputFiles"])`)
  so value-payload methods append `{ timeout }` as a separate arg instead of
  mutating the value object.

- **WR-02 — ACCEPTED (documented).** `--repeat-each` preserves completeness and
  `--max-failures` only ever yields a non-`passed` status when it trips (so the
  status gate already bails); neither is a prune-safety hole. Config-level
  `testMatch`/`testIgnore` narrowing is invisible to `isComplete` and is treated
  as the project's intended full suite (excluded tests' baselines are pruned by
  policy). Accepted as working-as-intended; the only robust alternative signal
  (config-derived totals vs `plannedTestCount`) is out of scope for Phase 3.

- **IN-01, IN-03, IN-04, IN-05 — ACCEPTED.** Informational only. IN-01:
  prototype-pollution-shaped keys are own-property assignments / `Object.fromEntries`
  results, never prototype writes, and values are validated fingerprints — no
  exploit. IN-03: the double `loadBaseline` is correct (refresh must layer over
  the committed file) and races nothing (worker teardown precedes reporter
  `onEnd`). IN-04: transient shards are intentionally non-atomic; a truncated
  shard fails soft to EMPTY and never corrupts the committed baseline. IN-05:
  the redundant-looking `entries: {}` spread is load-bearing (prevents shared
  reference mutation of `EMPTY_BASELINE`). No code change required for v1.
