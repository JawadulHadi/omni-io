# Sample knowledge base

Three short documents for a fictional store, Acme. Upload them from **Documents** in the console. Mark them **Public** if you want the widget to use them. Then try these questions in the **Playground**:

| Question | Expected result |
| --- | --- |
| When are refunds issued to my original payment method? | Tier 1: an answer citing `returns-policy.md` |
| When are refunds issued to my original payment method? `[fail:error]` | Tier 2: the same passage, verbatim |
| Does express shipping cost extra? | Tier 1: from `shipping.md` |
| Who pays customs duties on international orders? | Tier 1: from `shipping.md` (also works through the widget) |
| How do I reset my password? | Tier 3: a seeded FAQ answer |
| What is the weather on Mars? | Tier 3: the human hand-off message |

With `AI_PROVIDER=fake`, retrieval is a bag-of-words hash rather than a semantic model, so questions work best when they reuse the documents' own words. Real Gemini embeddings don't have this limitation. The `[fail:…]` markers only work with the fake provider. See [docs/resilience-ladder.md](../docs/resilience-ladder.md).
