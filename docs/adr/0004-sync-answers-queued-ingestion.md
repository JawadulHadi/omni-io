# ADR 0004: Synchronous answers under a time budget; queued ingestion

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The original spec routed both ingestion and answer generation through BullMQ "so a slow model call never blocks the request thread". That isn't a real reason: Node doesn't block on I/O. And a customer waiting for an answer can't usefully wait on a queue.

## Decision

- **Ingestion is queued.** It is long and retryable, and nobody is waiting on it. A separate worker process provides retries with exponential backoff, backpressure, and isolation from the API's CPU, memory and connection pool. Jobs carry ids only.
- **Answering is synchronous.** The model call is raced against `TIER1_TIMEOUT_MS` and guarded by a circuit breaker, so the worst case is a fast Tier 2 answer.

## Consequences

- Answer latency is bounded by configuration, not by queue depth.
- The circuit breaker is in-process, so each API instance trips independently. That is acceptable for protecting latency; a Redis-backed breaker is on the roadmap.
