import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { PlaygroundPage } from "./console/routes/playground";

// Stub pages — same shell pattern as PlaygroundPage; fill in per Section 6
// of the architecture doc (documents, ingestion, FAQs, members, widget, audit).
function StubPage({ name }: { name: string }) {
  return <div className="p-6 text-slate-500">{name} — TODO</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <nav className="w-56 border-r p-4 space-y-2">
          <div className="font-semibold mb-4">Omni.io</div>
          <Link className="block text-sm" to="/">Playground</Link>
          <Link className="block text-sm" to="/documents">Documents</Link>
          <Link className="block text-sm" to="/faqs">FAQs</Link>
          <Link className="block text-sm" to="/members">Members</Link>
          <Link className="block text-sm" to="/widget">Widget</Link>
          <Link className="block text-sm" to="/audit">Answer audit</Link>
        </nav>
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<PlaygroundPage />} />
            <Route path="/documents" element={<StubPage name="Documents" />} />
            <Route path="/faqs" element={<StubPage name="FAQs" />} />
            <Route path="/members" element={<StubPage name="Members" />} />
            <Route path="/widget" element={<StubPage name="Widget config" />} />
            <Route path="/audit" element={<StubPage name="Answer audit" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
