import { useState } from "react";

/**
 * Standalone embeddable chat bundle served at /w/:key — deliberately not
 * sharing a bundle with the admin console so a customer's page stays light.
 */
export function WidgetApp({ widgetKey }: { widgetKey: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "bot"; text: string }[]>([]);
  const [input, setInput] = useState("");

  async function send() {
    const userMsg = input;
    setMessages((m) => [...m, { role: "user", text: userMsg }]);
    setInput("");

    const res = await fetch(`/w/${widgetKey}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: userMsg }),
    });
    const data = await res.json();
    setMessages((m) => [...m, { role: "bot", text: data.answer }]);
  }

  return (
    <div className="fixed bottom-4 right-4 w-80 border rounded-lg shadow-lg bg-white flex flex-col h-96">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span className="inline-block bg-slate-100 rounded px-2 py-1 text-sm">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="flex border-t p-2 gap-2">
        <input className="flex-1 border rounded px-2 py-1 text-sm" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="text-sm px-3 py-1 bg-slate-900 text-white rounded" onClick={send}>Send</button>
      </div>
    </div>
  );
}
