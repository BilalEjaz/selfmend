# Phase 6: Standalone Persistence & Output - Research

**Researched:** 2026-06-02
**Domain:** Internal API re-exposure (thin wrappers over already-tested store + reporter internals)
**Confidence:** HIGH (whole-codebase read; every target function located and quoted)

## Summary

Phase 6 is a re-exposure phase, not a build. Every persistence and output primitive the
`@playwright/test` fixture+reporter used already exists, is pure, is unit-tested, and lives in
`src/store/*` and `src/reporter/reporter.ts`. The job is to add four standalone public symbols
(`loadBaseline`, `saveBaseline`, `mergeBaselines`, `renderHealSummary`) that wrap existing code,
plus confirm one already-built piece (`onHeal`).

Two findings shape the plan. First, **OUT-01 is already delivered by Phase 5** and reduces to a
confirming test: `wrapPage` accepts `onHeal`, builds a fire-and-forget `emit`, and the locator
proxy already calls `ctx.emit(...)` for BOTH the `healed` and the `refused`/`could-not-heal` arms.
Second, the **byte-identical `renderHealSummary` (OUT-02) is the only genuinely hard task**: the
reporter's box rendering currently lives in instance methods that read `this.heals` / `this.refused`,
so achieving a byte-identical guarantee requires extracting those methods into ONE shared pure
function that both the reporter and the new public export call. A copy would drift; do not copy.

A naming landmine: `src/store/persistence.ts` ALREADY exports a function named `loadBaseline`, but
its signature is `loadBaseline(rootDir, override?)` (resolves `.selfmend/baseline.json` under a root
dir and returns a `BaselineStore`). The public STORE-01 `loadBaseline(path)` takes a direct file
path. These must not collide. The plan must either rename the internal one or layer the public
path-based wrapper cleanly over the existing fs primitives (`atomicWrite`, `serialize`,
`parseBaseline`).

**Primary recommendation:** Add `src/store/standalone.ts` (public `loadBaseline(path)` /
`saveBaseline(path, store)` / `mergeBaselines(...stores)` wrapping `parseBaseline` + `serialize` +
`atomicWrite` + `refresh`/`mergeShards`), extract `src/reporter/render.ts` (pure
`renderHealSummary(events)` that the existing reporter is refactored to call), add a confirming
e2e + unit for `onHeal`, and export the four symbols from `src/index.ts`. Rename the internal
`persistence.ts#loadBaseline` to avoid the public-name collision.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OUT-01 | `onHeal` callback receives every heal event (healed + could-not-heal) | ALREADY DONE in Phase 5: `wrapPage` (`src/integration/wrap-page.ts:153,213-227`) wires `onHeal` -> `emit`; the proxy emits both arms (`src/integration/locator-proxy.ts:414` refused, `:454` healed). Scope to a confirming raw-mode test. |
| OUT-02 | `renderHealSummary(events)` renders the boxed summary byte-identical to the reporter | Extract the reporter's `render`/`renderHealedBox`/`renderRefusedSection`/`renderRow`/`renderRefusedRow`/`boxLine` + the module helpers (`stripAnsi`, `visibleLength`, `formatScore`) into a shared pure `renderHealSummary(events)`; refactor `SelfmendReporter.render()` to call it. |
| STORE-01 | `loadBaseline(path)` / `saveBaseline(path, store)` decoupled from reporter/shards | Wrap existing `parseBaseline` (`schema.ts:100`), `BaselineStore.fromBaseline`/`toBaselineFile` (`store.ts:43,129`), `serialize` (`serialize.ts:60`), `atomicWrite` (`persistence.ts:178`). |
| STORE-02 | `saveBaseline` refreshes-and-adds only, never auto-prunes | Use `refresh(existing, merged)` (`merge.ts:89`) which is `{...baseline.entries, ...captures}`, additive by construction. NEVER call `prune` (`merge.ts:110`); prune is gated only in the reporter (`reporter.ts:157`, `shouldPrune` `:571`). |
| STORE-03 | `mergeBaselines(...)` parallel-safe, no loss/corruption | Fold over the existing deterministic `mergeShards` (`merge.ts:60`) or its captures-only equivalent. Conflict rule is value-derived max-compare-key (`fingerprintCompareKey` `:31`), order-independent. |

## User Constraints (from CLAUDE.md, no CONTEXT.md present)

> No `06-CONTEXT.md` exists yet, this phase has not been through discuss-phase. The constraints
> below are project rules from `CLAUDE.md`, the ROADMAP, and the objective brief, and bind the plan.

### Locked Decisions (project rules)
- **TDD by default (RED first):** write the failing test, confirm it fails, implement to green. `tdd_mode: true` in config.
- **Fully offline / zero new runtime deps:** runtime deps are `zod` + `picocolors` ONLY. No new packages.
- **Never-false-green is invariant:** holds in raw mode exactly as in fixture mode. A wrong/missing identity key is a MISSED heal, never a wrong heal or false green. (Lives in the pure `decide()`; not touched here.)
- **Dual ESM/CJS**, peer `@playwright/test >=1.42`.
- **Keep the pure matching core untouched.**
- **No em dashes in any prose.**
- **Store-format version is part of the semver contract** (`STORE_FORMAT_VERSION = 1`): the file format must not change in this phase.

### Claude's Discretion
- Internal module layout for the new wrappers (new `src/store/standalone.ts` + `src/reporter/render.ts` recommended).
- How to resolve the internal `loadBaseline` name collision (rename vs namespacing).
- Whether `mergeBaselines` operates on `BaselineStore` instances or `BaselineFile` shapes (recommend `BaselineStore` for a consumer-facing API symmetric with `wrapPage({ store })`).

### Deferred Ideas (OUT OF SCOPE)
- Recipes / README / docs, that is Phase 7 (DOC-01), not here.
- BrowserContext-level wrapping, out of milestone scope.
- Any store-format change, JSON/HTML report files (v2-05), committed healed-selector store (v2-06).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `loadBaseline(path)` / `saveBaseline(path, store)` | fs adapter (`store/persistence.ts` family) | pure schema/serialize | Disk I/O is confined to the fs layer; parsing/serializing is pure. |
| refresh-and-add semantics | pure `store/merge.ts` (`refresh`) |, | Additive merge is value logic, no I/O. |
| `mergeBaselines(...)` | pure `store/merge.ts` (`mergeShards` fold) |, | Deterministic, order-independent, no I/O. |
| `onHeal` delivery | runner-agnostic core (`integration/wrap-page.ts` + `locator-proxy.ts`) |, | Already wired in Phase 5; emit seam is the boundary. |
| `renderHealSummary(events)` | pure renderer (new `reporter/render.ts`) | reporter consumes it | Rendering must be a single shared pure function so reporter and public export are byte-identical. |

## Standard Stack

No new dependencies. Everything reuses what is already installed.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | ^4.x (installed) | Validate on-disk baseline via `parseBaseline` | Already the schema gate; reuse, do not re-validate by hand. |
| `picocolors` | ^1.x (installed) | Color in the boxed summary | Already used by the reporter; the shared renderer keeps using it. |

**No installation step.** This phase adds source files only. The Package Legitimacy Audit is therefore
N/A (no external packages installed).

## Exact Reuse Map (the implementation-ready part)

### STORE-01, `loadBaseline(path)` / `saveBaseline(path, store)`

**Existing primitives to wrap (all already tested):**
- `parseBaseline(raw: unknown): BaselineFile`, `src/store/schema.ts:100`. Fail-soft, never throws, returns canonical EMPTY on any bad input. Reuse verbatim.
- `BaselineStore.fromBaseline(file): BaselineStore`, `src/store/store.ts:43`. Seeds a store from a `BaselineFile`.
- `BaselineStore.toBaselineFile(): BaselineFile`, `src/store/store.ts:129`. Snapshots a store to the committed `{version, entries}` shape (no `seen`).
- `serialize(store: BaselineFile): string`, `src/store/serialize.ts:60`. Deterministic, byte-stable, 2-space + trailing newline.
- `atomicWrite(target, data, options?)`, `src/store/persistence.ts:178`. Temp-file + rename with the Windows EPERM/EBUSY/EACCES retry loop. Reuse verbatim for save.

**New glue (`src/store/standalone.ts`):**
```ts
// load: read file (try/catch -> undefined), JSON.parse in try/catch,
//       parseBaseline (fail-soft), fromBaseline.
export async function loadBaseline(path: string): Promise<BaselineStore> { ... }

// save: existing = (file exists ? load : empty); next = refresh(existing.toBaselineFile(),
//       { captures: store's entries, seen: <unused> }); atomicWrite(path, serialize(next)).
export async function saveBaseline(path: string, store: BaselineStore): Promise<void> { ... }
```
This is the ONLY new fs-touching module besides `persistence.ts`; per the `persistence.ts:11-13`
"only module allowed to import node:fs" comment, the plan should either (a) put these wrappers IN
`persistence.ts` (cleanest, keeps the single fs home), or (b) relax that doc rule for one sibling.
Recommend (a): add path-based `loadBaselineFromPath` / `saveBaselineToPath` to `persistence.ts` and
export them publicly under the documented names.

**NAME COLLISION, must resolve:** `persistence.ts:92` already exports `loadBaseline(rootDir, override?)`
returning a `BaselineStore` from `.selfmend/baseline.json` under a root dir. The public STORE-01
`loadBaseline(path)` takes a literal file path. The reporter imports the internal one
(`reporter.ts:24`). Recommended fix: rename the internal `persistence.ts#loadBaseline` ->
`loadCommittedBaseline(rootDir, override?)`, update its one caller in `reporter.ts:152`, and free the
public name `loadBaseline` for the path-based export. (WRAP-04-style zero-behaviour-change: the
reporter's behaviour is identical, only the imported symbol name changes.)

**STORE-01 proof requires the reload-then-heal e2e:** Success Criterion 1 says "a heal works on a
later run from the saved file alone." That cannot be proven by a Vitest unit. It needs a Playwright
e2e: run 1 wraps a raw page, captures, `saveBaseline(path, store)`; run 2 does `loadBaseline(path)`
into a fresh store, mutates the selector, and asserts a real heal off the loaded file with no shards
and no reporter. Model it on `tests/wrap-page.spec.ts` + `tests/heal.spec.ts`.

### STORE-02, refresh-and-add only, never auto-prune

- `refresh(baseline, merged)`, `src/store/merge.ts:89`, body is `entries: { ...baseline.entries, ...merged.captures }`. Additive by construction: a key present before but absent from `captures` survives. This is exactly the STORE-02 guarantee.
- `prune(store, seenKeys)`, `src/store/merge.ts:110`, IS the destructive drop. `saveBaseline` MUST NOT call it.
- Where prune is gated today: ONLY in the reporter's `mergeAndPersist` (`reporter.ts:157`) behind `shouldPrune(complete, status, SELFMEND_PRUNE)` (`reporter.ts:571`), which requires a complete run AND passed AND the `SELFMEND_PRUNE` opt-in. The pure `prune` "looks at NO completeness flag" (`merge.ts:103-108`), the destructive decision is the call site's. `saveBaseline` is a refresh-only call site, so it simply never calls `prune`.
- **TDD invariant test (Vitest, pure):** seed a store with key K (no recapture for K this run), `saveBaseline`, reload, assert K still present. This is the literal Success Criterion 2.

### STORE-03, `mergeBaselines(...)`

- `mergeShards(shards: ShardFile[]): MergedShards`, `src/store/merge.ts:60`, already pure, already correct over overlapping AND disjoint inputs, already order-independent (`mergeShards([A,B])` deep-equals `mergeShards([B,A])` per its doc + `merge.test.ts`).
- **Conflict rule (state it explicitly in the plan):** when two inputs hold the SAME key with DIFFERENT fingerprints, the winner is the one whose value-derived `fingerprintCompareKey` (`merge.ts:31`) sorts LAST (max code-point order). It is a function of captured VALUES only, never of array position or worker timing. Identical captures collapse. Not last-write, not newest-timestamp, there are no timestamps in the fingerprint; it is a deterministic content-derived tiebreak.
- **New glue:** `mergeBaselines(...stores: BaselineStore[]): BaselineStore` is a thin fold. Each `BaselineStore` has no `seen` set semantics for this purpose, so build a `ShardFile`-shaped `{captures: store.toBaselineFile().entries, seen: []}` per input, `mergeShards` them, and `BaselineStore.fromBaseline({version, entries: merged.captures})`. (Or add a tiny captures-only `mergeCaptures` to `merge.ts` to avoid the empty-seen ceremony, discretion.)
- **TDD test (Vitest, pure):** merge over overlapping + disjoint stores; assert no entry lost, deterministic regardless of argument order. This is Success Criterion 3.

### OUT-01, `onHeal` (ALREADY DELIVERED in Phase 5)

- `WrapPageOptions.onHeal?: (event: SelfmendEvent) => void`, `src/integration/wrap-page.ts:153`. `SelfmendEvent` is the `HealedEvent | RefusedEvent` union (`events.ts:87`).
- `wrapPage` builds `emit` (`wrap-page.ts:213-227`): calls `onHeal` fire-and-forget, swallows throws and rejected promises, no-op when `onHeal` absent. Passes `emit` into every `HealContext` (`wrap-page.ts:253`).
- The proxy emits BOTH arms: refused at `locator-proxy.ts:414` (`kind:"refused"`, reasons `below-floor`/`ambiguous`/`no-candidates`), healed at `:454` (`kind:"healed"`), each guarded so a throwing emit never affects the run.
- **One honest caveat to verify in the confirming test:** the refused emit fires for the three POST-SCORING reasons only. An uncaptured locator (`no-fingerprint`) is re-thrown BEFORE scoring and is deliberately NOT surfaced as a refused event (`events.ts:50-56` documents this as intentional noise-suppression). So "could-not-heal" delivered to `onHeal` means the three post-scoring refusals, not "any failure." The plan's OUT-01 test should assert exactly the three refusal reasons reach `onHeal`, matching the reporter's `RefusedReason` set, and document that an uncaptured-locator failure is correctly silent (consistent with fixture mode, no behaviour difference between raw and fixture).
- **Scope of OUT-01 work:** a raw-mode confirming test (no Playwright reporter) that a healed event and a refused event both arrive at `onHeal`. Unit-level via the emit seam (see `src/integration/emit-seam.test.ts` as the model) plus optionally one e2e. No production code change expected; if the test reveals a gap, that gap is the real OUT-01 work.

### OUT-02, `renderHealSummary(events)` byte-identical

**This is the only hard task. The byte-identical guarantee demands a single shared renderer, not a copy.**

Today the rendering is INSTANCE state on the reporter, reading `this.heals` / `this.refused`:
- `render()`, `reporter.ts:174`, composes healed box + optional refused section.
- `renderHealedBox()`, `:182`, the N=0 quiet line + the boxed healed block.
- `renderRefusedSection()`, `:220`, null when no refusals, else the warning-colored box.
- `renderRow(h)` / `renderRefusedRow(r)`, `:253` / `:270`.
- `boxLine(colored, plain, width)`, `:283`.
- Module helpers: `formatScore` `:387`, `stripAnsi` `:395` (exported), `visibleLength` `:400`, plus the box-drawing chars and `pc` color calls.

**New glue (`src/reporter/render.ts`):** extract a PURE
`renderHealSummary(events: SelfmendEvent[]): string` that partitions `events` into healed vs refused
(by `kind`, with missing-kind === healed per `events.ts:34`), then runs the EXACT current box logic.
Move `formatScore`, `visibleLength`, the box-drawing, and the per-row/box composition into this module.
Keep `stripAnsi` exported from here (re-export from `reporter.ts` if any external import relies on it).

**Refactor the reporter to call it (zero output change):** `SelfmendReporter.render()` becomes
`return renderHealSummary([...this.heals, ...this.refused])` (preserving the current healed-first,
refused-second ordering, the shared function must reproduce that ordering exactly). The reporter
keeps `onBegin`/`onTestEnd`/`onEnd`/`mergeAndPersist` unchanged.

**Ordering subtlety to lock in the plan:** the reporter renders heals in test-completion order
(`this.heals` push order, `:108`) and refusals likewise. `renderHealSummary(events)` receives a flat
event array, so the public contract is "render in the order given, healed box first then refused box,
each in input order." The byte-identical guarantee is: for the SAME event sequence, reporter output
== `renderHealSummary` output. The plan must assert this with a snapshot test that feeds the SAME
events to both a `SelfmendReporter` (via its attachment path) and `renderHealSummary`, and asserts
string equality (not just `toContain`).

**Reporter-only state that must move into / be passed to the shared function:**
- counts (`n`), derived from input array length, no state needed.
- ordering, caller-supplied input order (documented above).
- color, `picocolors` auto-detects; identical in both paths. The existing tests strip ANSI via `visible()` for layout assertions and keep one color-on alignment test (`reporter.test.ts:106`). The byte-identical snapshot should run with a fixed color mode (force-color or no-color) so CI is deterministic.

## Architecture Patterns

### System Architecture (data flow)

```
RAW FRAMEWORK MODE (Phase 6 target)                    @playwright/test MODE (unchanged)
-----------------------------------                    --------------------------------
wrapPage(page, { store, onHeal })                      fixture -> wrapPage(... emit=attach)
        |                                                       |
   locator proxy: heal/refuse decision                    same proxy, same decide()
        |                                                       |
   ctx.emit(event) --> onHeal(event)  [OUT-01]           ctx.emit --> testInfo.attach
        |                                                       |
   collect events in user array                          reporter.onTestEnd reads attachments
        |                                                       |
   renderHealSummary(events) ---------- SHARED PURE -----> reporter.render()  [OUT-02 byte-identical]
        |                                                       |
   saveBaseline(path, store) [STORE-01/02]               reporter.mergeAndPersist (shards->merge->refresh->atomicWrite)
        |  refresh-only, atomicWrite, serialize                 |  same refresh + atomicWrite + serialize
   loadBaseline(path) next run --> heal off file alone    loadCommittedBaseline(rootDir) at worker start

   mergeBaselines(...stores) [STORE-03]  -- folds the same deterministic mergeShards logic
```

### Recommended new files
```
src/
  store/
    standalone.ts   # OR fold loadBaseline(path)/saveBaseline(path,store)/mergeBaselines into persistence.ts
  reporter/
    render.ts       # pure renderHealSummary(events) extracted from reporter.ts; reporter calls it
```

### Anti-Patterns to Avoid
- **Copying the box-rendering into a second function.** Guarantees drift; violates the byte-identical requirement. Extract once, call twice.
- **Calling `prune` from `saveBaseline`.** Breaks STORE-02. `saveBaseline` is refresh-only.
- **Changing `STORE_FORMAT_VERSION` or the serialized shape.** It is a semver contract; v1 files must round-trip unchanged.
- **Re-implementing fs reads/writes outside the fs adapter.** Reuse `atomicWrite`; keep the single auditable I/O home.
- **Deriving identity from a URL** in any new raw-mode example (already forbidden in `wrap-page.ts`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Read+validate a baseline file | Manual JSON.parse + field checks | `parseBaseline` (`schema.ts:100`) | Fail-soft, strict, version-gated, raw-DOM-leak-rejecting, already tested. |
| Atomic save on Windows | `fs.writeFile` directly | `atomicWrite` (`persistence.ts:178`) | Temp+rename with the EPERM/EBUSY/EACCES retry loop already solved. |
| Byte-stable serialization | `JSON.stringify(store)` | `serialize` (`serialize.ts:60`) | Sorted keys + fixed field order + trailing newline = zero diff churn. |
| Refresh-and-add merge | `Object.assign` ad hoc | `refresh` (`merge.ts:89`) | Exact additive semantics STORE-02 needs, already proven. |
| Deterministic N-way merge | Hand loop with last-write-wins | `mergeShards` (`merge.ts:60`) | Order-independent value-derived conflict rule, already proven over overlap+disjoint. |
| Boxed summary rendering | New box drawing | extract from `reporter.ts:174-287` | The ONLY way to guarantee byte-identical output (OUT-02). |

**Key insight:** Phase 6 has almost no new logic. Its risk is entirely in (a) not duplicating the
renderer, (b) not re-running prune, (c) not breaking the existing reporter during the extraction, and
(d) resolving the `loadBaseline` name collision cleanly.

## Runtime State Inventory

> This is a re-exposure phase, not a rename/migration. No stored data, live service config,
> OS-registered state, secrets, or build artifacts carry a string that changes here. The one rename
> is the INTERNAL symbol `persistence.ts#loadBaseline` -> `loadCommittedBaseline`, which is a code
> edit with exactly one caller (`reporter.ts:152`); no on-disk or runtime state references it.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None, the on-disk `baseline.json` format is unchanged (`STORE_FORMAT_VERSION` stays 1) | none |
| Live service config | None, offline plugin, no services | none |
| OS-registered state | None | none |
| Secrets/env vars | `SELFMEND_PRUNE`, `SELFMEND_STORE_DIR`, `SELFMEND_DEBUG` exist; this phase reads none of them in the new public API (save is prune-free) | none |
| Build artifacts | `src/index.ts` exports grow (four new symbols); `dist/` and `.d.ts` regenerate on build | rebuild (`npm run build`) before publish |

## Common Pitfalls

### Pitfall 1: The `loadBaseline` name collision
**What goes wrong:** Two `loadBaseline` functions with different signatures (`(rootDir)` vs `(path)`).
**Why:** The internal fs adapter already owns the name.
**How to avoid:** Rename internal -> `loadCommittedBaseline`, update `reporter.ts:152`, free the public name.
**Warning sign:** TypeScript duplicate-export error or the reporter loading the wrong file.

### Pitfall 2: Renderer drift breaking byte-identity
**What goes wrong:** `renderHealSummary` and the reporter diverge by a space, color, or ordering.
**Why:** Two implementations.
**How to avoid:** Single shared pure function; reporter calls it. Snapshot test feeds identical events to both and asserts string equality.
**Warning sign:** A `toContain` test passes but a full-string equality test fails.

### Pitfall 3: Accidental prune in `saveBaseline`
**What goes wrong:** An entry that captured nothing this run vanishes after save.
**Why:** Reusing the reporter's merge path that includes the gated prune.
**How to avoid:** `saveBaseline` calls ONLY `refresh`, never `prune`. Test the survival invariant.
**Warning sign:** Success Criterion 2 fails.

### Pitfall 4: Breaking the existing reporter during extraction (WRAP-04-style regression)
**What goes wrong:** The 23 e2e + reporter unit tests change output after refactor.
**Why:** Moving rendering code can subtly alter spacing/ordering.
**How to avoid:** Refactor under green: extract, point reporter at the shared fn, run the full reporter test suite + e2e, assert zero output change.
**Warning sign:** `reporter.test.ts` or `tests/report.spec.ts` diffs.

### Pitfall 5: Misreporting OUT-01 scope
**What goes wrong:** Planning OUT-01 as new work when Phase 5 already delivered it.
**Why:** The brief lists it as pending.
**How to avoid:** Scope OUT-01 to a confirming test; document the intentional `no-fingerprint` silence so "every could-not-heal" is read correctly as "every post-scoring refusal," identical to fixture mode.

## Code Examples

### Existing additive refresh (STORE-02 guarantee, verbatim)
```ts
// Source: src/store/merge.ts:89
export function refresh(baseline: BaselineFile, merged: MergedShards): BaselineFile {
  return { version: STORE_FORMAT_VERSION, entries: { ...baseline.entries, ...merged.captures } };
}
```

### Existing atomic save primitive to reuse (STORE-01)
```ts
// Source: src/store/persistence.ts:178, temp-file + rename with Windows retry loop
await atomicWrite(targetPath, serialize(baselineFile));
```

### onHeal already wired both arms (OUT-01)
```ts
// Source: src/integration/wrap-page.ts:213, fire-and-forget emit -> onHeal
const emit = (event: SelfmendEvent): void => { const h = opts.onHeal; if (!h) return; try { ... } catch {} };
// Source: src/integration/locator-proxy.ts:414 (refused) and :454 (healed), both call ctx.emit(...)
```

## State of the Art

No external state-of-the-art shift applies, this is internal API surfacing over an existing,
shipped engine. The relevant "state" is the codebase as of Phase 5 completion (2026-06-02): the
emit seam is pluggable, the store layer is pure + fs-confined, and the reporter holds the only copy
of the box renderer.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `mergeBaselines` should operate on `BaselineStore` instances (not `BaselineFile`) for a consumer-facing API | STORE-03 | Low, discretion; either typing works, only the signature shape changes. |
| A2 | Folding `BaselineStore`s through `mergeShards` with empty `seen` is acceptable vs adding a captures-only helper | STORE-03 | Low, both are pure and deterministic; cosmetic choice. |
| A3 | OUT-01 needs no production change, only a confirming test | OUT-01 | Medium, if the confirming test reveals refused events do not reach `onHeal` in some path, that is the real OUT-01 work. Mitigated: code read shows both arms call `ctx.emit`. |
| A4 | Forcing a fixed color mode in the byte-identical snapshot is acceptable for determinism | OUT-02 | Low, matches how existing reporter tests handle color. |

## Open Questions

1. **Where do the path-based wrappers physically live?**
   - What we know: `persistence.ts` declares itself the only fs-importing module.
   - What's unclear: add to `persistence.ts` vs a sibling `standalone.ts`.
   - Recommendation: add to `persistence.ts` to keep the single auditable I/O home; export publicly from `index.ts`.

2. **Does `mergeBaselines` need its own `seen`-aware variant, or is captures-only sufficient?**
   - What we know: consumers merging per-worker baselines care about entries, not the run's seen-set (prune is not in scope here).
   - Recommendation: captures-only merge; do not expose `seen`/prune to raw consumers.

## Environment Availability

> Skipped, no new external tools, services, or runtimes. This phase adds TypeScript source that
> compiles with the existing toolchain (tsdown, Vitest, the installed Playwright peer for e2e).

## Security Domain

`security_enforcement` is not set to false in config, so the relevant ASVS surface is noted, though
this phase adds no new attack surface (no network, no auth, no new input parsing beyond the existing
`parseBaseline`).

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V5 Input Validation | yes | `parseBaseline` (zod strict, version-gated, raw-DOM-leak-rejecting) already validates the only untrusted input (the on-disk file); reuse it, do not bypass. |
| V8 Data Protection | yes | Serializer emits derived signals only; no raw DOM (`schema.ts:28-38` strict object). Unchanged here. |
| V12 File handling | yes | `atomicWrite` + the path-containment logic in `storeRoot` (`persistence.ts:46`). The PUBLIC `saveBaseline(path)` takes a caller-supplied literal path by design (the consumer chooses where their baseline lives), so it does NOT apply the `.selfmend` containment clamp, note this in the plan as intended (a raw consumer owns their path), distinct from the env-override clamp. |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed / hand-edited baseline file | Tampering | `parseBaseline` fail-soft to EMPTY, never throws, never half-reads. |
| Foreign/old store version | Tampering | `z.literal(STORE_FORMAT_VERSION)` rejects -> EMPTY (ignore-and-recapture). |
| Path traversal via caller path | Tampering | PUBLIC `saveBaseline(path)` trusts the consumer's own path (their project, their choice); the internal env-override path keeps its existing `storeRoot` clamp. Document the distinction. |

## Sources

### Primary (HIGH confidence), direct codebase reads
- `src/store/store.ts`, `persistence.ts`, `merge.ts`, `serialize.ts`, `schema.ts`, store layer.
- `src/reporter/reporter.ts`, box renderer + merge/persist + prune gate.
- `src/integration/events.ts`, `wrap-page.ts`, `locator-proxy.ts` (emit grep), onHeal seam.
- `src/index.ts`, current public exports.
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (Phase 6 section), `CLAUDE.md`, `.planning/config.json`.
- `src/reporter/reporter.test.ts`, `vitest.config.ts`, `tests/` listing, TDD seam.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new deps; all reuse targets located and quoted.
- Architecture / reuse map: HIGH, every function cited by file:line from direct reads.
- OUT-01 already-done finding: HIGH, both emit arms confirmed in `locator-proxy.ts`; `onHeal` wiring confirmed in `wrap-page.ts`.
- OUT-02 byte-identical design: HIGH, renderer located; extraction path is mechanical.
- Pitfalls: HIGH, name collision and prune-gating verified in source.

**Research date:** 2026-06-02
**Valid until:** stable until the store format or reporter renderer changes (no expiry concern for an internal re-exposure phase).
