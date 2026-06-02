// Compile-only type shims for the example recipes.
//
// These ambient module declarations let examples/cucumber.ts and
// examples/mocha-jest.ts type-check WITHOUT installing @cucumber/cucumber,
// mocha, or jest. They are NOT a runtime dependency: selfmend ships zero of
// these frameworks, and the examples are type-checked (noEmit) against the
// built package, never executed. An adopter who copies a recipe installs the
// real framework, whose own types then replace these shims.
//
// Each declaration models ONLY the symbols the recipes reference, and only
// closely enough that the selfmend wiring type-checks. It is deliberately
// minimal, not a faithful model of the framework.

// Cucumber (@cucumber/cucumber): the hook + step symbols the recipe wires
// selfmend into, plus a minimal World the recipe attaches the wrapped page to.
declare module "@cucumber/cucumber" {
  import type { Page } from "@playwright/test";

  // The per-scenario World. The recipe stores the wrapped page and the two
  // stable identity strings (feature name + scenario name) that scope() reads
  // live. `page` is optional because it is assigned in a Before hook.
  export interface SelfmendWorld {
    page?: Page;
    featureName: string;
    scenarioName: string;
  }

  // Hook + step registrars. The callback receives the World as `this`, so the
  // recipe declares `function (this: SelfmendWorld)` to type that binding.
  type HookFn = (this: SelfmendWorld) => void | Promise<void>;
  type StepFn = (this: SelfmendWorld, ...args: unknown[]) => void | Promise<void>;

  export function Before(fn: HookFn): void;
  export function After(fn: HookFn): void;
  export function BeforeAll(fn: () => void | Promise<void>): void;
  export function AfterAll(fn: () => void | Promise<void>): void;
  export function Given(pattern: string | RegExp, fn: StepFn): void;
  export function When(pattern: string | RegExp, fn: StepFn): void;
  export function Then(pattern: string | RegExp, fn: StepFn): void;
  export function setWorldConstructor(ctor: new (...args: unknown[]) => unknown): void;
}

// Mocha / Jest share the before/after/beforeEach/describe/it hook names, so one
// shim covers the single mocha-jest recipe. Declared as ambient globals because
// that mirrors how both runners inject them (Mocha via --ui bdd globals, Jest
// via its globals injection).
declare global {
  function before(fn: () => void | Promise<void>): void;
  function after(fn: () => void | Promise<void>): void;
  function beforeEach(fn: () => void | Promise<void>): void;
  function describe(name: string, fn: () => void): void;
  function it(name: string, fn: () => void | Promise<void>): void;
}

export {};
