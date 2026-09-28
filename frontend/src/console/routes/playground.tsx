import { useState } from "react";

type Tier = "ai_answer" | "rag_snippets" | "faq_floor";

interface Citation { chunkId: string; snippet: string }
interface AnswerResult { tier: Tier; answer: string; citations: Citation[]; confidence?: number }

const TIER_LABEL: Record<Tier, { label: string; color: string }> = {
  ai_answer: { label: "Tier 1 · AI answer", color: "bg-emerald-100 text-emerald-800" },
  rag_snippets: { label: "Tier 2 · RAG snippets", color: "bg-amber-100 text-amber-800" },
  faq_floor: { label: "Tier 3 · FAQ floor", color: "bg-rose-100 text-rose-800" },
};

/**
 * Shows support staff *why* an answer looked the way it did — which rung of
 * the resilience ladder produced it, and the exact chunks/FAQ that backed it.
 */
export function PlaygroundPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    try {
      // TODO: replace with the real GraphQL `askQuestion` mutation via the urql client.
      const res = await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `mutation($q: String!) { askQuestion(query: $q) { tier answer confidence citations { chunkId snippet } } }`,
          variables: { q: query },
        }),
      });
      const json = await res.json();
      setResult(json.data.askQuestion);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Playground</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question a customer might ask..."
        />
        <button className="px-4 py-2 rounded bg-slate-900 text-white" onClick={ask} disabled={loading}>
          {loading ? "Asking..." : "Ask"}
        </button>
      </div>

      {result && (
        <div className="border rounded p-4 space-y-3">
          <span className={`inline-block text-xs font-medium px-2 py-1 rounded ${TIER_LABEL[result.tier].color}`}>
            {TIER_LABEL[result.tier].label}
            {result.confidence != null && ` · confidence ${result.confidence.toFixed(2)}`}
          </span>
          <p>{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-500">Citations</p>
              {result.citations.map((c) => (
                <div key={c.chunkId} className="text-sm bg-slate-50 border rounded p-2">
                  {c.snippet}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
