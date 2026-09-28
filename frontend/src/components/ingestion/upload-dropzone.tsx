import { Loader2, UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Label, Select } from '@/components/ui/form-controls';
import { API_BASE, readError } from '@/lib/api';
import { getAccessToken, tokenExpiringSoon, useAuth } from '@/lib/auth';
import type { Visibility } from '@/lib/gql';
import { cn, formatBytes } from '@/lib/utils';

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ['.pdf', '.txt', '.md', '.markdown'];

export function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const { refresh } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('internal');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPT.includes(ext)) return setError('Only PDF, TXT and Markdown files are supported.');
    if (file.size > MAX_BYTES) return setError(`That file is ${formatBytes(file.size)} — the limit is 20 MB.`);

    const body = new FormData();
    body.append('file', file);
    body.append('visibility', visibility);
    setBusy(file.name);
    try {
      if (tokenExpiringSoon()) await refresh();
      const res = await fetch(`${API_BASE}/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body,
      });
      if (!res.ok) throw await readError(res);
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  }

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
          dragging && 'border-ring bg-accent',
        )}
      >
        {busy ? <Loader2 className="size-7 animate-spin text-muted-foreground" aria-hidden /> : <UploadCloud className="size-7 text-muted-foreground" aria-hidden />}
        <p className="text-sm font-medium">{busy ? `Uploading ${busy}…` : 'Drop a PDF, TXT or Markdown file'}</p>
        <p className="text-xs text-muted-foreground">Up to 20 MB. Text is extracted, chunked and embedded in the background.</p>
        <input ref={input} type="file" accept={ACCEPT.join(',')} className="sr-only" id="upload-input" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => input.current?.click()}>
          Choose file
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="upload-visibility" className="shrink-0">
          Visibility
        </Label>
        <Select id="upload-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} className="max-w-56">
          <option value="internal">Internal — console only</option>
          <option value="public">Public — widget can use it</option>
        </Select>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  );
}
