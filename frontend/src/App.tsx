import { Loader2 } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { IngestionProgressProvider } from '@/components/ingestion/progress-context';
import { ConsoleLayout } from '@/components/layout/console-layout';
import { AuthProvider, useAuth } from '@/lib/auth';
import { UrqlProvider } from '@/lib/urql';
import { LoginPage } from './console/routes/login';

// Route-level code splitting: each console screen is its own chunk.
const PlaygroundPage = lazy(() => import('./console/routes/playground'));
const DocumentsPage = lazy(() => import('./console/routes/documents'));
const IngestionPage = lazy(() => import('./console/routes/ingestion'));
const FaqsPage = lazy(() => import('./console/routes/faqs'));
const MembersPage = lazy(() => import('./console/routes/members'));
const WidgetPage = lazy(() => import('./console/routes/widget'));
const AuditPage = lazy(() => import('./console/routes/audit'));
const TokensPage = lazy(() => import('./console/routes/tokens'));
const InvitePage = lazy(() => import('./console/routes/invite'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center" aria-busy="true">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Restoring session" />
      </div>
    );
  }
  if (state.status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/invite/:token"
            element={
              <Suspense fallback={null}>
                <InvitePage />
              </Suspense>
            }
          />
          <Route
            element={
              <RequireAuth>
                <UrqlProvider>
                  <IngestionProgressProvider>
                    <ConsoleLayout />
                  </IngestionProgressProvider>
                </UrqlProvider>
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/playground" replace />} />
            <Route path="playground" element={<PlaygroundPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="ingestion" element={<IngestionPage />} />
            <Route path="faqs" element={<FaqsPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="widget" element={<WidgetPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="tokens" element={<TokensPage />} />
            <Route path="*" element={<Navigate to="/playground" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
