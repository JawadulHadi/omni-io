# ADR 0005: Treat model output as untrusted input

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

A model can return prose instead of JSON, a confidence as a string, or a citation it made up. The scaffold accepted any non-empty citation list, so a fabricated chunk id still produced a "cited" answer.

The inputs are untrusted too: retrieved passages come from uploaded documents, and questions can come from anonymous visitors.

## Decision

- Providers (Gemini, or the fake) return **raw text plus token usage**. They don't judge quality.
- The ladder accepts an answer only if all of these hold:
  - the output parses with a zod schema
  - every cited id is one of the passages actually sent
  - confidence is at or above the workspace threshold
  - retrieval found something above the similarity floor
- Prompts are built defensively:
  - passages go in delimited blocks, with delimiter-like text neutralized
  - the system prompt treats all context as data
  - output is constrained by a JSON schema (`responseJsonSchema`)
- Tokens spent on a rejected answer are still recorded.

## Consequences

- A hallucinated citation can't reach a customer as a Tier 1 answer.
- Self-reported confidence is never the only gate.
- Switching providers means implementing a small interface (`embed`, `generateAnswer`) and nothing else.
