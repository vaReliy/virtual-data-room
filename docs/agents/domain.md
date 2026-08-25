# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — domain vocabulary used in code, tests and UI.
- **`docs/decisions.md`** — this repo's architectural decision record. Unlike a typical `docs/adr/` directory of one file per decision, it's a single running log of accepted decisions with rationale. Read it before changing anything architectural; check it for existing rationale before proposing a new one.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/
│   ├── decisions.md      ← architectural decision log (append-only, not per-file ADRs)
│   ├── data-model.md
│   ├── architecture.md
│   └── roadmap.md
└── apps/ packages/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap worth flagging to the user.

## Flag decision conflicts

If your output contradicts an existing entry in `docs/decisions.md`, surface it explicitly rather than silently overriding:

> _Contradicts decision #8 (Google OAuth only) — but worth reopening because…_
