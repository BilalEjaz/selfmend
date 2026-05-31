# Pitfalls Research

**Domain:** Offline, locator-only self-healing Playwright plugin (npm package, fixture + reporter)
**Researched:** 2026-05-31
**Confidence:** HIGH on the false-green/matching analysis and Playwright API surface (verified against Playwright docs and Healenium's published threshold model); MEDIUM on distribution specifics (verified against current ESM/CJS guidance and Playwright module-hell issues).

## Critical Pitfalls

### Pitfall 1: The false-green trap (healing masks a genuine regression)

**What goes wrong:**
A locator stops resolving because the feature it pointed at was genuinely removed, broken, or changed (the Submit button was deleted, the checkout step regressed, a permission now hides the element). The healer finds the *next most similar* element on the page, scores it high enough, rebinds, and the test passes. A real defect ships under a green suite. This is the single failure mode that destroys the product: a self-healing tool that produces false greens is worse than no tool, because it actively launders bugs into "passing" CI.

**Why it happens:**
- A confidence score is always *relative to the candidates present*. If the right element is gone, the scorer still returns a "best" candidate, and "best of what remains" can still clear a naive threshold.
- Two structurally similar elements (two "Delete" buttons, a row in a duplicated list, a primary vs. secondary CTA) produce near-identical fingerprints, so the top match is ambiguous but scores high in absolute terms.
- Teams tune the threshold *down* over time to "stop the noise," eroding the floor until almost anything heals.

**How to avoid:**
- **Absolute confidence floor, never auto-relaxed.** A heal only fires when the top candidate's score is above a configured floor. The floor must be a hard gate, not a soft preference. Default high (≈0.90, matching Healenium's recommended posture) and document that lowering it trades safety for green-ness.
- **Margin / disambiguation gate, separate from the floor.** Require the top candidate to beat the second-best by a minimum margin (e.g. top ≥ floor AND (top − second) ≥ delta). If two candidates are both plausible, that is *ambiguity*, not a heal — fail the test and report both. This is the specific guard against "two similar elements" that an absolute threshold alone misses.
- **Heal only the resolution, never the assertion.** v1 is locator-only by design (already in scope). Rebinding *where to find the element* is recoverable; rebinding *what to assert* hides bugs. Keep this boundary sacred and enforce it in code, not just in docs.
- **No candidates ⇒ no heal ⇒ normal failure.** If nothing clears the floor, the test fails as it would have without the plugin. Make this the default and untoggleable path.
- **Treat "element genuinely gone" as a first-class outcome.** When the original locator misses and no candidate clears the gate, the report should say "could not heal" loudly, not silently. The absence of a heal is signal.

**Warning signs:**
- Heal rate climbing run over run (drift — see Pitfall 7).
- Heals where the top-2 candidate scores are within a few points of each other.
- Heals on pages with repeated/list structures.
- Anyone requesting a lower threshold to "reduce failures."

**Phase to address:**
Core matching/scoring phase. The margin gate and the "no-force-heal" path are acceptance criteria for that phase, not enhancements.

---

### Pitfall 2: Unstable fingerprint signals produce bad baselines AND bad matches

**What goes wrong:**
The fingerprint is captured from signals that are not stable across builds: auto-generated class names (`css-1a2b3c`, `sc-bdVaJa`), hashed/CSP-nonce attributes, framework-generated ids (`:r3a:`, `radix-:R1:`), dynamic text (timestamps, counts, prices), and i18n-translated text. A baseline built on these is poisoned: either it never matches again (every run "heals," defeating the point) or it matches the wrong thing because the unstable signal happened to collide.

**Why it happens:**
- The naive fingerprint captures everything available because more signals *feel* more robust.
- The very churn that makes locators break (build-hash class names, regenerated ids) is exactly what gets captured if you fingerprint raw DOM attributes uncritically.
- Locale-dependent suites capture English text as a "stable" signal, then heal-storm when run in another locale.

**How to avoid:**
- **Weight signals by intrinsic stability, do not treat them equally.** Stable: `data-testid` and other test-ids, ARIA role, accessible name, semantic attributes (`name`, `type`, `href` patterns), DOM position relative to stable anchors. Unstable: generated class names, hashed attributes, exact dynamic text. Score with the stable signals dominant and the unstable ones as weak tiebreakers at most.
- **Detect and down-rank entropy.** Heuristically flag attribute values that look generated (hash-like, high-entropy, framework prefixes) and discount them. This is cheap and prevents the most common baseline poisoning.
- **Normalise text before fingerprinting** (trim, collapse whitespace, strip digits/dates where configurable) and treat exact text as a soft signal. Recommend role + accessible-name over raw text, aligning with Playwright's own locator philosophy.
- **Document i18n explicitly:** baselines are locale-specific; warn users running multi-locale suites against a shared baseline.

**Warning signs:**
- Baseline file churns on every commit even when the UI is unchanged.
- Heal events that all hinge on a class/id signal.
- A locale switch causes mass heals.

**Phase to address:**
Fingerprint capture phase. Signal-stability weighting and entropy down-ranking are core requirements, not v2.

---

### Pitfall 3: Intercepting Playwright internals via monkey-patching

**What goes wrong:**
To catch a failed resolution and rebind, the obvious shortcut is to monkey-patch `Locator` methods or hook private internals. This breaks across Playwright minor versions (Playwright ships frequently and refactors internals freely), fights the auto-waiting engine, and introduces races: Playwright's locators are lazy and actions auto-wait/retry, so patching `click`/`waitFor` can fire the heal *during* legitimate auto-wait retries, healing a transient miss that would have resolved on its own milliseconds later.

**Why it happens:**
- There is no single documented "on locator resolution failed" callback, so authors reach for the prototype.
- Auto-waiting is invisible: a locator that "fails" right now may succeed on the next internal poll, so naive interception cannot tell "not yet" from "gone."

**How to avoid:**
- **Prefer supported extension points.** `selectors.register()` is the official custom selector-engine API (query/queryAll, registered before page creation, registerable as a worker-scoped fixture) and the Reporter API + fixtures (`test.extend`) are stable, documented surfaces. Build the plugin as a custom locator/selector layer plus a reporter, not as a prototype patch. `addLocatorHandler` (Playwright 1.42+) is a related supported hook for the "element appeared unexpectedly" case but is not a resolution-failure hook — do not conflate them.
- **Heal only after auto-wait has genuinely exhausted.** Trigger healing on a real timeout/resolution failure, not on a first poll miss. Respect the locator's configured timeout so you never short-circuit auto-waiting. Healing a transient is just flakiness with extra steps.
- **Pin a peer-dependency range and run a compatibility matrix in CI** against the lowest and highest supported Playwright minors (see Pitfall 8). If you must touch anything not in the public API, isolate it behind one adapter module with a runtime capability check and a clear failure message, never sprinkle it through the codebase.

**Warning signs:**
- Plugin breaks on a Playwright patch/minor bump.
- Heals firing on elements that are merely slow to appear.
- New flakiness *introduced* after installing the plugin.

**Phase to address:**
Integration / interception architecture phase (early — this decision shapes everything). Compatibility matrix belongs in the CI/release phase.

---

### Pitfall 4: Parallel workers corrupt or race on the shared baseline store

**What goes wrong:**
Playwright runs tests across multiple worker processes by default. If every worker reads and writes a single baseline file (JSON), concurrent writes interleave and corrupt the file, last-writer-wins silently drops other workers' updates, and tests read stale or half-written baselines mid-run. Sharded CI (multiple machines) makes it worse: each shard has its own filesystem and they never reconcile.

**Why it happens:**
- The baseline "is just a file," so the first implementation does `readFile` → mutate → `writeFile` from every worker with no coordination.
- Local single-worker dev hides the bug; it only appears under CI parallelism.

**How to avoid:**
- **Separate read path from write path.** During a run, treat the baseline as read-only (immutable input). Accumulate captured fingerprints per-worker in memory or per-worker temp files, then merge once in a single global teardown (Playwright's `globalTeardown` / reporter `onEnd`, which runs once). Never have N workers write the same file concurrently.
- **Make capture writes append-only and worker-scoped** (e.g. one file per worker keyed by worker index), merged deterministically at the end. Deterministic merge avoids order-dependent corruption.
- **Be explicit about CI sharding:** document that baseline updates must be collected and merged across shards (artifact upload + merge step), or scope baselines so shards do not need to share live writes.
- For v1 (console-only output, baseline not yet committed per PROJECT.md scope), this is mostly an in-memory concern — but the capture-then-merge architecture must be chosen now so v2's persisted store does not require a rewrite.

**Warning signs:**
- Corrupted/invalid JSON baseline after a parallel run.
- Baseline updates from some workers "disappearing."
- Heal behaviour differs between `--workers=1` and default.

**Phase to address:**
Baseline store / persistence phase. Architect for parallelism from the first store design.

---

### Pitfall 5: Performance overhead of fingerprinting on every resolution

**What goes wrong:**
Capturing a rich fingerprint (text, role, attributes, neighbours, DOM position) on *every* locator resolution on a passing run means serializing DOM context across the Playwright client/browser boundary thousands of times per suite. Done eagerly and synchronously, it can add meaningful wall-clock time to every test and slow the suite the plugin was meant to keep healthy — the adoption killer for a CI tool.

**Why it happens:**
- Fingerprinting is bolted onto the hot path (every `click`/`fill`/`waitFor`) instead of being sampled or deferred.
- Neighbour/position capture walks the DOM per element, and each cross-boundary `evaluate` call has latency.

**How to avoid:**
- **Capture in a single batched `evaluate` per element**, computing the whole fingerprint in one round trip rather than one call per signal.
- **Only fingerprint on capture-relevant events, not literally every internal poll.** Capture once per successful resolution per locator per run, deduplicated; do not re-capture on auto-wait retries.
- **Make capture overhead measurable and budgeted.** Add a benchmark to CI (suite time with plugin off vs on) and set a target (e.g. <5–10% overhead). Treat regressions against it as failures.
- **Allow capture to be disabled in time-critical runs** while keeping healing-from-existing-baseline on.

**Warning signs:**
- Suite runtime jumps after install.
- Per-test time scales with element count more than before.
- Profiling shows many small `evaluate` calls.

**Phase to address:**
Fingerprint capture phase; benchmark gate in the CI/release phase.

---

### Pitfall 6: Silent healing with no audit trail (trust collapse)

**What goes wrong:**
The plugin heals quietly and the suite goes green. The team never learns that a locator drifted, the underlying selector rot accumulates invisibly, and the day a heal is *wrong* (Pitfall 1) nobody has any record to diagnose it. Worse, a tool that changes test behaviour without telling you is one teams rip out the moment they distrust it.

**Why it happens:**
- "It just works" feels like the goal, so the heal is treated as success and not surfaced.
- Reporting is deferred as polish rather than treated as the core trust mechanism.

**How to avoid:**
- **Every heal is loud by default.** The end-of-run console summary (already in scope) must list, per heal: original selector, healed target (a re-derivable description, not an opaque handle), confidence score, and the runner-up score/margin so reviewers can judge ambiguity.
- **Heals are visible, not just logged.** Surface heal count prominently; a run with heals is "passed, with N heals to review," not a silent green.
- **Reporting is a phase-1 deliverable, not v2.** The console summary is the v1 trust contract. The persisted/JSON/HTML report is explicitly v2 per PROJECT.md, but the *console* audit trail is non-negotiable for v1.

**Warning signs:**
- A heal happened but nothing in the output mentions it.
- Reviewers cannot reconstruct *what* healed to *what*.
- "Did the suite heal anything?" is unanswerable after a run.

**Phase to address:**
Reporting phase (must be in v1 scope, parallel with or immediately after matching).

---

### Pitfall 7: Healing drift — the suite quietly diverges from intent

**What goes wrong:**
Over weeks, heals stack on heals. Each heal individually clears the threshold, but cumulatively the test now interacts with elements the author never intended. The suite still passes, but it no longer tests what it was written to test. The plugin becomes a slow-acting suite-rotting agent.

**Why it happens:**
- Heals are treated as permanent silent fixes rather than alerts to update the source locator.
- There is no feedback loop pushing the human to fix the actual selector, so the heal becomes the permanent state.

**How to avoid:**
- **Heals are temporary rescues, not fixes.** The product proposes; it never silently rewrites tests (already a PROJECT.md boundary). Reinforce by making repeated heals on the same locator escalate in the report ("this locator has healed N runs in a row — update it").
- **Track heal recurrence**, not just per-run heals. A locator that heals every run is a maintenance task, surfaced as such.
- **Never let a heal silently update the baseline to the healed target** without a human in the loop, or drift compounds (the healed-wrong element becomes the new baseline). Baseline updates from heals must be opt-in / reported, not automatic.

**Warning signs:**
- The same locators heal repeatedly across runs.
- Total heal count trends up while nobody updates selectors.
- Tests pass but manual review shows they hit unintended elements.

**Phase to address:**
Reporting + baseline-update policy phase. Recurrence tracking is a concrete report feature.

---

### Pitfall 8: Distribution mistakes (ESM/CJS, peer-dep range, semver)

**What goes wrong:**
The package fails to install or import in real Playwright projects: ESM/CJS dual-format mistakes (Playwright's own tooling historically wants CJS in places while modern projects use ESM — a documented pain area in Playwright), an over-tight or over-loose peer-dependency range on `@playwright/test` (too tight blocks adopters; too loose claims compatibility you never tested), or breaking the public config/API in a minor release and burning trust.

**Why it happens:**
- TypeScript dual-publishing (ESM + CJS + correct `types`) is still error-prone; wrong `exports` map breaks `require` or `import` for half of consumers.
- Authors test against one Playwright version and declare a wide `peerDependencies` range optimistically.

**How to avoid:**
- **Decide the module strategy deliberately.** For a new 2026 package, ESM-first is reasonable (Node 23+ can `require()` ESM), but because Playwright's runner has had CJS/ESM friction, validate the chosen format by installing into a real ESM project *and* a real CJS project in CI before publishing. Use a correct conditional `exports` map with matching `types`.
- **Set a tested peer-dependency range** (e.g. `>=1.42 <2`) and prove it with a CI matrix against the lowest and highest claimed Playwright minors. `addLocatorHandler` / API choices set your real floor — do not claim support below what you test.
- **Follow semver strictly for the public surface** (config keys, threshold names, reporter contract). Any change to defaults (especially the confidence floor) is at least a minor with a loud changelog entry; lowering the safety default is effectively breaking.

**Warning signs:**
- Issues like "cannot import" / "require is not defined" from adopters.
- Works in the author's repo, fails in a consumer's ESM/CJS setup.
- Plugin breaks on a Playwright bump within the declared range.

**Phase to address:**
Packaging / release phase. Install-matrix and Playwright-version-matrix are CI gates before first publish.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single shared JSON baseline written by all workers | Trivial to implement | Corruption/races under CI parallelism; rewrite needed | Only with `--workers=1`; never as the shipped default |
| Monkey-patch `Locator` prototype to catch failures | Fast to prototype | Breaks across Playwright minors; fights auto-wait | Spike only; not in a release |
| Absolute threshold with no second-best margin gate | Simpler scoring | False greens on ambiguous/duplicate elements | Never — the margin gate is the core safety feature |
| Capture every signal with equal weight | Less heuristic code | Baseline poisoned by generated ids/hashes; heal-storms | Never as default; allow as an explicit "raw" debug mode |
| Auto-update baseline to the healed element | "Stops re-healing" | Compounds drift; locks in wrong matches | Never automatic; only human-reviewed opt-in |
| Wide `peerDependencies` range, tested on one version | Looks broadly compatible | Breaks on untested Playwright versions | Never; range must equal tested matrix |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Playwright resolution | Hooking private internals / patching prototypes | Use `selectors.register()` + Reporter API + fixtures; isolate any unofficial touch behind one adapter |
| Auto-waiting engine | Healing on first poll miss | Heal only after the locator's real timeout/resolution failure |
| Parallel workers | N workers writing one baseline file | Read-only during run; capture per-worker; merge once in global teardown / reporter `onEnd` |
| Reporter lifecycle | Printing per-test instead of aggregated | Aggregate heals and print the summary in `onEnd` (runs once) |
| `addLocatorHandler` (1.42+) | Treating it as a resolution-failure hook | It handles unexpected overlays, not heal-on-miss; do not conflate |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-signal `evaluate` calls | Many small cross-boundary calls; per-test time scales with element count | One batched `evaluate` computing the whole fingerprint | Large pages / element-heavy suites |
| Re-fingerprinting on auto-wait polls | Capture count >> resolution count | Capture once per resolved locator per run, deduplicated | Any suite with retries/slow elements |
| Eager capture on every passing action | Suite runtime jumps after install | Budgeted overhead with a CI benchmark gate (<5–10%); allow capture toggle | Medium/large suites in CI |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Any network call / telemetry in the heal path | Violates the hard offline requirement; leaks DOM/app data out of CI | Zero network by design; CI test that asserts no outbound connections during a run |
| Persisting full DOM/innerText to baseline | Sensitive page content (PII, tokens) committed to a repo | Store minimal derived signals, not raw DOM; document and allow redaction of text capture |
| Reporter logging full element content to console/CI logs | Secrets surfaced in shared CI logs | Log derived selector descriptions and scores, not raw values |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Heal succeeds but output is silent | Team loses trust; drift accumulates invisibly | Loud per-heal summary with scores and margin every run |
| Threshold knob with no guidance | Users lower it to stop noise, inviting false greens | Ship a safe default (~0.90), document the safety tradeoff, warn on low values |
| Opaque "healed to <internal handle>" | Reviewers cannot judge if the heal was correct | Report a human-readable, re-derivable target description |
| No way to tell "couldn't heal" from "no break" | Genuine regressions look like ordinary passes | Surface "could not heal — N failures" explicitly |

## "Looks Done But Isn't" Checklist

- [ ] **Confidence gate:** Often missing the second-best *margin* check — verify ambiguous duplicate elements fail rather than heal.
- [ ] **No-force-heal path:** Often only the happy path is tested — verify that "no candidate clears the floor" fails the test normally and says so.
- [ ] **Parallel safety:** Often only tested at `--workers=1` — verify baseline integrity under default workers and under sharding.
- [ ] **Auto-wait respect:** Often heals on transient misses — verify no heal fires while a slow-but-present element is still within its timeout.
- [ ] **Offline guarantee:** Often assumed — verify with a network-blocked CI run that nothing is sent.
- [ ] **Audit trail completeness:** Often missing runner-up score/margin — verify every heal entry lets a reviewer judge ambiguity.
- [ ] **Install matrix:** Often tested only in the author's repo — verify install + import in fresh ESM and CJS projects.
- [ ] **Playwright version range:** Often optimistic — verify against the lowest and highest declared minors in CI.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| False greens shipped (Pitfall 1) | HIGH | Add the margin gate; raise the floor; audit historical heal reports to find masked regressions; treat as a security-grade incident for the suite |
| Baseline corruption under parallelism (Pitfall 4) | MEDIUM | Switch to per-worker capture + single merge; regenerate baseline; add a parallel CI test |
| Monkey-patch breaks on Playwright bump (Pitfall 3) | MEDIUM–HIGH | Migrate to `selectors.register()` + reporter; isolate any unofficial code behind one adapter; add version matrix |
| Poisoned baselines from unstable signals (Pitfall 2) | MEDIUM | Add stability weighting + entropy down-ranking; regenerate baseline; review heal-storm history |
| ESM/CJS install failures (Pitfall 8) | LOW–MEDIUM | Fix `exports`/`types` map; add fresh-project install matrix; patch release |
| Drift / suite divergence (Pitfall 7) | MEDIUM | Add recurrence tracking; surface stale-locator escalations; manual selector cleanup pass |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. False-green trap | Matching/scoring phase | Tests: duplicate elements fail; removed element fails; below-floor fails — all without forcing a heal |
| 2. Unstable fingerprint signals | Fingerprint capture phase | Baseline stable across no-op rebuilds; heals do not hinge on generated ids/classes |
| 3. Intercepting internals | Integration/interception architecture phase | Plugin survives a Playwright minor bump; no heal on within-timeout transient |
| 4. Parallel baseline corruption | Baseline store phase | Valid baseline + identical heal behaviour under default workers and sharding |
| 5. Fingerprint overhead | Capture phase + CI gate | Suite-time benchmark (off vs on) within budget |
| 6. Silent healing / no audit | Reporting phase (v1) | Every heal appears with original, target, score, and runner-up margin |
| 7. Healing drift | Reporting + baseline-update policy phase | Repeated heals escalate; no automatic baseline rewrite to healed target |
| 8. Distribution (ESM/CJS, peer-dep, semver) | Packaging/release phase | Install matrix (ESM+CJS) + Playwright version matrix green before publish |

## Sources

- Playwright docs — Selectors / `selectors.register()` custom selector engines (query/queryAll, register-before-page, worker-scoped fixture): https://playwright.dev/docs/api/class-selectors and https://playwright.dev/docs/extensibility (HIGH)
- Playwright `addLocatorHandler` (shipped ~1.42): https://www.martinpoole.cv/blog/playwright-locator-handler (MEDIUM)
- Playwright CJS/ESM module friction (official issues): https://github.com/microsoft/playwright/issues/23662 and https://github.com/microsoft/playwright/issues/36252 (HIGH)
- Healenium score-cap / threshold model and silent-substitution false-green risk: https://www.automatetheplanet.com/healenium-self-healing-tests/ and https://github.com/healenium/healenium-web (MEDIUM–HIGH)
- Self-healing false-positive / regression-masking analysis: https://crosscheck.cloud/blogs/self-healing-tests-ai/ and https://getautonoma.com/blog/ai-self-healing-test-automation (MEDIUM)
- Dual ESM/CJS + peer-dependency publishing guidance (2025–2026): https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing and https://snyk.io/blog/building-npm-package-compatible-with-esm-and-cjs-2024/ (MEDIUM)
- PROJECT.md scope/constraints (offline, locator-only, confidence floor, console-only v1): `.planning/PROJECT.md` (HIGH)

---
*Pitfalls research for: offline locator-only self-healing Playwright plugin*
*Researched: 2026-05-31*
