import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useClient, useSubscription } from 'urql';
import { DOCUMENTS_QUERY, INGESTION_DOCUMENTS_QUERY, INGESTION_PROGRESS, type IngestionProgress } from '@/lib/gql';

type ProgressMap = Record<string, IngestionProgress>;
const ProgressContext = createContext<ProgressMap>({});

/**
 * One subscription for the whole console. Documents and Ingestion both read
 * live progress from here; a terminal event (ready/failed) refetches the
 * documents list so status, chunk counts and errors come from the source of truth.
 */
export function IngestionProgressProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const [progress, setProgress] = useState<ProgressMap>({});
  const [{ data }] = useSubscription<{ ingestionProgress: IngestionProgress }>({ query: INGESTION_PROGRESS });

  useEffect(() => {
    const event = data?.ingestionProgress;
    if (!event) return;
    setProgress((p) => ({ ...p, [event.documentId]: event }));
    if (event.status === 'ready' || event.status === 'failed') {
      for (const query of [DOCUMENTS_QUERY, INGESTION_DOCUMENTS_QUERY]) {
        void client.query(query, {}, { requestPolicy: 'network-only' }).toPromise();
      }
    }
  }, [data, client]);

  return <ProgressContext.Provider value={progress}>{children}</ProgressContext.Provider>;
}

export const useIngestionProgress = () => useContext(ProgressContext);
