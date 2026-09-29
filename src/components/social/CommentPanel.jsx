import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { STATUS, safePermalink } from '@/lib/social/domain';
import { originLabel } from '@/lib/social/integrations';

export default function CommentPanel({ comment, onClose, replies, drafts, permissions, aiConfigured, client }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const draft = drafts.filter(d => d.comment_id === comment.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const permalink = safePermalink(comment.permalink);
  async function suggest() {
    setBusy(true); setError('');
    try { await client.draftReply(comment.id); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  // Phase one has no configured send transport. Preserve explicit human confirmation.
  async function approve() {
    setBusy(true); setError('');
    try { await client.approveAndReply({ commentId: comment.id, transport: comment.transport, text, draftId: draft?.id, confirmHuman: reviewed, expectedVersion: comment.version }); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent className="w-full sm:max-w-xl overflow-y-auto">
    <SheetHeader><SheetTitle>Comentário · {originLabel(comment)}</SheetTitle><SheetDescription>{comment.author_name} · {new Date(comment.created_at).toLocaleString('pt-BR')} · {STATUS[comment.status]}</SheetDescription></SheetHeader>
    <div className="mt-5 space-y-5">
      {comment.requires_attention && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Requer atenção · revisão humana</p>}
      <p className="whitespace-pre-wrap break-words">{comment.text}</p>
      <div><h3 className="font-medium">Publicação</h3><p className="text-sm">{comment.post_title || comment.external_post_id || 'Não informada'}</p>{permalink && <a className="text-sm underline" href={permalink} target="_blank" rel="noopener noreferrer">Abrir publicação</a>}</div>
      <div><h3 className="font-medium">Histórico de respostas</h3>{replies.filter(r => r.comment_id === comment.id).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map(r => <div key={r.id} className="mt-2 rounded-lg border p-3 text-sm"><p>{r.text}</p><p className="text-xs text-slate-500">{r.status} · {new Date(r.created_at).toLocaleString('pt-BR')} · {r.approved_by || 'Aprovação não informada'}</p></div>)}{!replies.some(r => r.comment_id === comment.id) && <p className="text-sm text-slate-500">Nenhuma resposta registrada.</p>}</div>
      <div><h3 className="font-medium">Sugestão da IA</h3><p className="my-2 text-sm text-slate-500">{draft?.text || (aiConfigured ? 'Nenhuma sugestão gerada.' : 'IA não configurada')}</p><Button variant="outline" disabled={!permissions.approve_ai || !aiConfigured || busy || comment.requires_attention} onClick={suggest}>Gerar resposta com IA</Button>{draft && <Button variant="ghost" onClick={() => { setText(draft.text); setReviewed(false); }}>Editar resposta</Button>}</div>
      <label className="block text-sm font-medium">Escrever resposta<Textarea className="mt-2" maxLength={2000} value={text} disabled={!permissions.reply} onChange={e => { setText(e.target.value); setReviewed(false); }}/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={!permissions.reply} onChange={e => setReviewed(e.target.checked)}/>Revisei o texto e aprovo esta resposta.</label>
      <Button disabled={!permissions.reply || !reviewed || !text.trim() || busy} onClick={approve}>Aprovar e responder</Button>
      <p className="text-xs text-slate-500">Envio indisponível nesta fase. Nenhuma resposta será publicada.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </SheetContent></Sheet>;
}
