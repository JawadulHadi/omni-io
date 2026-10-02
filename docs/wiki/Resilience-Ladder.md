# Resilience ladder

| What goes wrong | The customer gets |
| --- | --- |
| Nothing | **Tier 1**: a model answer citing verified passages |
| The model errors, times out, returns invalid JSON, cites a passage it wasn't given, writes an answer its citations don't support, or isn't confident enough; or the daily budget is spent | **Tier 2**: the top ≤ 3 relevant excerpts, verbatim |
| Nothing relevant is found, or the embedding API or vector search is down | **Tier 3**: a keyword-matched FAQ, or a human hand-off message |
| The audit write fails | The same answer; the failure is only logged |

Tier 1 needs four independent checks to pass:

1. a similarity floor on retrieval;
2. schema-valid output;
3. citations ⊆ retrieved ids;
4. confidence above the threshold *and* the answer grounded in its citations.

Each dependency has its own timeout and circuit breaker: 5 consecutive failures open it, a 30-second cool-down follows, then a single half-open probe.

Every outcome records a reason, such as `tier1_timeout`, `tier1_invalid_citation`, `tier1_ungrounded`, `tier1_budget_exhausted`, `retrieval_circuit_open` or `no_relevant_context`. A rising Tier 2 or Tier 3 share is the earliest warning of a provider outage or a content gap.

Details: [`docs/resilience-ladder.md`](https://github.com/JawadulHadi/omni-io/blob/main/docs/resilience-ladder.md).
