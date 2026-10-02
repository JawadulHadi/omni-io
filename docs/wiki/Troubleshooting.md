# Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm test` fails with `require() of ES Module` | Your Node is older than 24.9. Use Node 24 LTS (`nvm use` reads `.nvmrc`) |
| Every answer is Tier 3 "no relevant context" with real Gemini | The similarity floor is still the seed's 0.1 setting tuned for the fake provider, or nothing is indexed. Set it to 0.6 under *Ladder settings* and check that documents are `ready` |
| Every answer is Tier 2 with `tier1_circuit_open` | The model failed 5 times in a row. Check `GEMINI_API_KEY` and quota. The breaker retries after 30 s |
| `tier1_budget_exhausted` | The workspace used its `TIER1_DAILY_LIMIT_PER_WORKSPACE` model calls for the day |
| The console logs out every 15 minutes | Console and API are on different *sites*, so the `SameSite=Strict` refresh cookie isn't sent. Serve them from one origin or the same site, and set `VITE_API_BASE` |
| The widget doesn't appear | The key was rotated or is wrong. The widget stays hidden on a bad key. Copy the new snippet from *Widget* |
| The widget answers "I don't know" to things the console answers | The widget only uses documents and FAQs marked **public** |
| Uploads stay `failed` with a Retry button | Redis was unreachable when the upload arrived. Check `/health`, then press Retry |
| `match_chunks` errors about `hnsw.iterative_scan` | Your pgvector is older than 0.8. Upgrade the extension |
| The API refuses to start in production | `COOKIE_SECURE` must be `true`, and `JWT_SECRET` must not be the example value |
| Everyone shares one rate limit | Set `TRUST_PROXY` to the number of proxies in front of the API |
