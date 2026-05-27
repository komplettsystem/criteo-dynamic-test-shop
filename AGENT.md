# Agent Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks (single-line fixes, log additions, typo corrections), use judgment and skip ceremony.

**Precedence:** Project-specific instructions always override these base guidelines. Where they conflict, the project's rules win.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Understand Before Acting

**Read the codebase. Choose the right scope.**

Before writing or changing code:
- Read the relevant files, modules, and tests to understand what already exists.
- Identify existing patterns, conventions, and utilities — use them instead of reinventing.
- Determine the appropriate scope: is this a one-file fix, a cross-module change, or an architectural shift?
- Don't guess at interfaces, data shapes, or module boundaries — look them up.

## 3. Clarify the Spec

**For non-trivial work, confirm the what before starting the how.**

- For any task touching multiple files or introducing new behavior, restate the requirement and confirm before writing code.
- If the requirement is ambiguous, present your interpretation and ask — don't resolve ambiguity silently.
- When implementation diverges from the original spec, surface the divergence and update the spec before continuing.
- Skip this for single-file fixes or clearly scoped tasks where the intent is obvious.

## 4. Test First

**Default to TDD. Write a failing test, then make it pass.**

- Write a test that captures expected behavior before implementing the solution.
- For bug fixes: write a test that reproduces the bug, then fix it.
- For new features: write tests for the core behavior and edge cases, then implement.
- Skip only for exploratory spikes or infrastructure where the interface is still being defined — and flag explicitly that tests are owed.
- Tests should be meaningful, not ceremonial. Test behavior, not implementation details.

## 5. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 6. Fail Visibly

**No silent fallbacks. Surface failures, don't hide them.**

- Don't add fallback behavior, default values, or graceful degradation unless explicitly asked.
- Don't wrap code in try/catch blocks that swallow errors or return empty defaults.
- When a failure scenario exists, highlight it and suggest a fallback strategy — let the user decide.
- Errors should propagate clearly so bugs are found and fixed, not masked.

The test: If something breaks, will the developer know immediately, or will the failure hide behind a silent fallback?

## 7. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 8. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 9. Research and Agent Workflows

Three patterns govern non-trivial research and autonomous agent work. Choose based on the goal:

| Pattern | Use when |
|---|---|
| **[RESEARCH-LOOP.md](RESEARCH-LOOP.md)** | Building encyclopedic coverage of a topic; accumulate until 80–90% coverage; PR-based human checkpoints |
| **[EXPERIMENT-LOOP.md](EXPERIMENT-LOOP.md)** | Testing a specific hypothesis; needs a measurable quality signal; commit only findings that improve the score; agent runs unsupervised |
| **[AGENTIC-ENGINEERING.md](AGENTIC-ENGINEERING.md)** | Framing any agent task — human writes goal + constraints + done criteria; agents author the artifact; human reviews like a PR |

For any research request, first decide: one-off answer, or does it warrant a persistent knowledge base? If persistent, pick the right loop.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes, failures are caught early instead of hidden, and tests exist before the code they validate.

---

## Project-Specific Guidelines

<!-- Project-specific rules, conventions, and stack context go below this line.
     The base guidelines above come from github.com/komplettsystem/agent-patterns (AGENT-BASE.md).
     Do not edit the base section here — update AGENT-BASE.md in that repo instead. -->
---

## Project-Specific Guidelines

<!-- Project-specific rules, conventions, and stack context go here.
     The base guidelines above come from agent-patterns/AGENT-BASE.md.
     Do not edit the base section here — update AGENT-BASE.md instead. -->
