import { useRef, useState } from 'react';
import { send } from './api';
import { toDataUrl } from './image';
import { Button } from '@/components/ui/button';
/** View / attach / replace / remove a journal entry's screenshot. The image is fetched with the auth header and shown from a blob URL. */
export function Shot({ entry, onChange, onError }: { entry: any; onChange: () => void; onError: (e: any) => void }) {
  const [url, setUrl] = useState<string | null>(null), input = useRef<HTMLInputElement>(null);
  const view = async () => { const r = await fetch(`/api/journal/${entry.id}/screenshot`); if (!r.ok) return onError(new Error('Screenshot not found')); setUrl(URL.createObjectURL(await r.blob())); };
  const close = () => { if (url) URL.revokeObjectURL(url); setUrl(null); };
  const upload = async (f: File) => { try { await send('POST', `/api/journal/${entry.id}/screenshot`, { dataUrl: await toDataUrl(f) }); onChange(); } catch (e) { onError(e); } };
  const remove = async () => { try { await send('DELETE', `/api/journal/${entry.id}/screenshot`); close(); onChange(); } catch (e) { onError(e); } };
  return <>
    {entry.screenshot && <button onClick={view}>View</button>} <button onClick={() => input.current?.click()}>{entry.screenshot ? 'Replace' : 'Attach'}</button>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
    {url && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={close}>
      <div className="max-h-full max-w-5xl space-y-2" onClick={e => e.stopPropagation()}>
        <img src={url} alt="Trade screenshot" className="max-h-[80vh] rounded border border-border" />
        <div className="flex gap-2"><Button size="sm" onClick={close}>Close</Button><Button size="sm" variant="destructive" onClick={remove}>Remove screenshot</Button></div></div></div>}
  </>;
}
