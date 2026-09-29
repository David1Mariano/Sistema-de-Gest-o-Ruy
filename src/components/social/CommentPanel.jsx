import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { STATUS, safePermalink } from '@/lib/social/domain';
import { originLabel } from '@/lib/social/integrations';
import { SOCIAL_AI_CATEGORIES } from '@/lib/social/aiCategories';

// Rótulos derivados da MESMA allowlist que o backend valida. Se a lista mudar
// no servidor, a UI segue coerente — não mantém duas listas divergentes.
const CATEGORY_LABEL = Object.freeze(Object.fromEntries(SOCIAL_AI_CATEGORIES.map((c) => [c, c.replace(/_/g, ' ')])));
const HEALTH_LABEL = Object.freeze({
  ready: 'IA local pronta.',
  not_configured: 'IA local não configurada no servidor.',
  offline: 'IA local indisponível — suba o Ollama.',
  model_unavailable: 'Modelo da IA local ausente no servidor.',
  error: 'Não foi possível verificar a IA local.',
});

export default function CommentPanel({ comment, onClose, replies, drafts, permissions, aiClient, client }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [health, setHealth] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const latestRef = useRef(0);
  const draft = drafts.filter(d => d.comment_id === comment.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const permalink = safePermalink(comment.permalink);

  // O health é lido do BACKEND, nunca do navegador: a URL do Ollama não existe
  // no cliente. Falha aqui só significa "IA indisponível", nunca quebra o painel.
  useEffect(() => {
    let alive = true;
    aiClient?.health().then(state => { if (alive) setHealth(state); }).catch(() => { if (alive) setHealth({ status: 'error', ready: false }); });
    return () => { alive = false; };
  }, [aiClient]);

  // Só a última resposta escreve na tela: clique duplo ou "Gerar novamente" não
  // podem deixar a sugestão antiga sobrescrever a nova.
  async function suggest() {
    if (busy) return;
    const token = ++latestRef.current;
    setBusy(true); setError('');
    try {
      const result = await aiClient.suggest(comment);
      if (token !== latestRef.current) return;
      setSuggestion(result);
    } catch (e) {
      if (token !== latestRef.current) return;
      setSuggestion(null);
      setError(e?.message || 'Não foi possível gerar uma sugestão. Você pode responder manualmente.');
    } finally {
      if (token === latestRef.current) setBusy(false);
    }
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
      <div>
        <h3 className="font-medium">Sugestão da IA</h3>
        <p className="text-xs text-slate-500">{HEALTH_LABEL[health?.status] || 'Verificando IA local...'}</p>
        {suggestion ? <div className="mt-2 space-y-2">
          <p className="whitespace-pre-wrap break-words rounded-lg border p-3 text-sm">{suggestion.text}</p>
          <p className="text-xs text-slate-500">
            Categoria: {CATEGORY_LABEL[suggestion.category] || CATEGORY_LABEL.outro}
            {Number.isFinite(suggestion.confidence) ? ` · confiança ${Math.round(suggestion.confidence * 100)}%` : ''}
            {!suggestion.categoryRecognized ? ' · categoria não reconhecida, revisão humana' : ''}
          </p>
          {suggestion.requiresHuman && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Requer humano — sugestão para revisão, nunca envio automático.</p>}
        </div> : <p className="my-2 text-sm text-slate-500">Nenhuma sugestão gerada.</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!permissions.approve_ai || !health?.ready || busy} onClick={suggest}>{busy ? 'Gerando sugestão...' : 'Gerar sugestão com IA'}</Button>
          {suggestion && <Button variant="ghost" disabled={busy} onClick={() => { setText(suggestion.text); setReviewed(false); }}>Editar</Button>}
          {suggestion && <Button variant="ghost" disabled={busy} onClick={suggest}>Gerar novamente</Button>}
          {draft && <Button variant="ghost" onClick={() => { setText(draft.text); setReviewed(false); }}>Usar rascunho salvo</Button>}
        </div>
      </div>
      <label className="block text-sm font-medium">Escrever resposta<Textarea className="mt-2" maxLength={2000} value={text} disabled={!permissions.reply} onChange={e => { setText(e.target.value); setReviewed(false); }}/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={!permissions.reply} onChange={e => setReviewed(e.target.checked)}/>Revisei o texto e aprovo esta resposta.</label>
      <Button disabled={!permissions.reply || !reviewed || !text.trim() || busy} onClick={approve}>Aprovar e responder</Button>
      <p className="text-xs text-slate-500">Envio indisponível nesta fase. Nenhuma resposta será publicada.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </SheetContent></Sheet>;
}
