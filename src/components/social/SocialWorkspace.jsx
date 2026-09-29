import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, ShieldCheck } from 'lucide-react';
import StatCard from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import SocialChart from '@/components/social/SocialChart';
import CommentPanel from '@/components/social/CommentPanel';
import { PLATFORMS, METRICS, STATUS, CATEGORIES, periodRange, previousPeriod, filterComments, commentSummary } from '@/lib/social/domain';
import { emptySocialSnapshot, socialClient } from '@/lib/social/client';

function Choice({ label, value, onChange, options, disabled = false }) {
  return <label className="flex flex-col gap-1 text-xs text-slate-600">{label}<select className="h-10 rounded-md border bg-white px-3 text-sm text-slate-900 disabled:opacity-60" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{Object.entries(options).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>;
}
function Summary({ comments, provider, range }) {
  const summary = commentSummary(comments, provider, range, false);
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Object.entries(METRICS).map(([key, label]) => <StatCard key={key} label={label} value={summary[key] == null ? '—' : summary[key]} hint="Integração não configurada" icon={MessageCircle}/>)}</div>;
}
export default function SocialWorkspace({ permissions, client = socialClient, initialTab = 'dashboard' }) {
  const [data, setData] = useState(emptySocialSnapshot);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('all');
  const [mode, setMode] = useState('7');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [sentiment, setSentiment] = useState('all');
  const [search, setSearch] = useState('');
  const [metric, setMetric] = useState('engagements');
  const [selected, setSelected] = useState(null);
  const range = periodRange(mode, start, end);
  const previous = previousPeriod(range);
  useEffect(() => {
    let active = true;
    client.snapshot().then(value => { if (active) setData(value); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);
  const comments = useMemo(() => filterComments(data.comments, { provider, status, category, sentiment, search, range }), [data.comments, provider, status, category, sentiment, search, range]);
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Redes Sociais</h1><p className="mt-1 text-sm text-slate-500">Comentários, desempenho e relacionamento com seu público.</p></div><span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-xs"><ShieldCheck className="h-4 w-4 text-amber-600"/>Respostas automáticas desativadas</span></header>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
      <Choice label="Plataforma" value={provider} onChange={setProvider} options={{ all: 'Todas', ...PLATFORMS }}/>
      <Choice label="Período" value={mode} onChange={setMode} options={{ today: 'Hoje', 7: '7 dias', 30: '30 dias', custom: 'Personalizado' }}/>
      {mode === 'custom' && <><label className="text-xs">Início<Input type="date" value={start} onChange={e => setStart(e.target.value)}/></label><label className="text-xs">Fim<Input type="date" value={end} onChange={e => setEnd(e.target.value)}/></label></>}
      {range && <p className="pb-2 text-xs text-slate-500">{range.start} a {range.end} · São Paulo</p>}
    </div>
    {!range && <p role="alert" className="text-sm text-red-700">Informe um período válido: início menor ou igual ao fim.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <Tabs defaultValue={initialTab}><TabsList className="mb-4"><TabsTrigger value="dashboard">Dashboard</TabsTrigger>{permissions.report && <TabsTrigger value="reports">Relatórios</TabsTrigger>}<TabsTrigger value="integrations">Integrações</TabsTrigger></TabsList>
      <TabsContent value="dashboard" className="space-y-5">
        <Summary comments={data.comments} provider={provider} range={range}/>
        <Choice label="Métrica do gráfico" value={metric} onChange={setMetric} options={METRICS}/>
        <SocialChart metrics={data.metrics} provider={provider} metric={metric} range={range}/>
        <section className="rounded-xl border bg-white p-5 space-y-4"><h2 className="font-semibold">Comentários recentes</h2>
          <div className="flex flex-wrap items-end gap-3"><Choice label="Status" value={status} onChange={setStatus} options={{ all: 'Todos', ...STATUS }}/><Choice label="Categoria sugerida pela IA" value={category} onChange={setCategory} options={{ all: 'Todas', ...Object.fromEntries(CATEGORIES.map(c => [c, c])) }} disabled={!data.aiConfigured}/><Choice label="Sentimento sugerido pela IA" value={sentiment} onChange={setSentiment} options={{ all: 'Todos', positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo' }} disabled={!data.aiConfigured}/><label className="flex-1 min-w-48 text-xs text-slate-600">Pesquisar<Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, comentário ou publicação"/></label></div>
          <p className="text-xs text-slate-500">Mais recentes primeiro · {data.aiConfigured ? 'Classificações são sugestões.' : 'IA não configurada'}</p>
          {loading ? <p role="status">Carregando...</p> : !comments.length ? <div className="rounded-lg border border-dashed p-10 text-center"><MessageCircle className="mx-auto mb-3 h-7 w-7 text-slate-400"/><p className="font-medium">{data.accounts.length ? 'Nenhum comentário para estes filtros' : 'Integração não configurada'}</p><p className="mt-1 text-sm text-slate-500">Os comentários aparecerão após a conexão oficial de uma conta.</p></div> : <div className="divide-y">{comments.map(c => <button key={c.id} className="block w-full py-4 text-left hover:bg-slate-50" onClick={() => setSelected(c)}><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{c.author_name} · {PLATFORMS[c.provider]}</strong><span>{new Date(c.created_at).toLocaleString('pt-BR')}</span></div><p className="my-2 line-clamp-2">{c.text}</p><p className="text-xs text-slate-500">{c.post_title || c.external_post_id} · {STATUS[c.status]}{data.drafts.some(d => d.comment_id === c.id) ? ' · Sugestão da IA disponível' : ''}</p>{c.requires_attention && <p className="mt-2 text-sm font-medium text-amber-700">Requer atenção</p>}{data.replies.filter(r => r.comment_id === c.id && r.status === 'sent').slice(-1).map(r => <p key={r.id} className="mt-2 text-sm text-slate-600">Resposta: {r.text}</p>)}</button>)}</div>}
        </section>
      </TabsContent>
      {permissions.report && <TabsContent value="reports" className="space-y-5"><h2 className="text-lg font-semibold">Relatórios</h2><Summary comments={data.comments} provider={provider} range={range}/><Choice label="Métrica do relatório" value={metric} onChange={setMetric} options={METRICS}/><SocialChart metrics={data.metrics} provider={provider} metric={metric} range={range}/><div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Comparação por período</h3><p className="my-2 text-xs text-slate-500">Atual: {range ? `${range.start} a ${range.end}` : 'Inválido'}<br/>Anterior: {previous ? `${previous.start} a ${previous.end}` : 'Inválido'}</p><p className="text-sm">Integração não configurada</p></section><section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Posts com melhor desempenho</h3><p className="mt-2 text-sm text-slate-500">Integração não configurada</p><p className="mt-2 text-xs text-slate-500">Comparação restrita à mesma plataforma e definição de métrica.</p></section></div><p className="text-xs text-slate-500">Taxa de resposta = comentários do período com resposta confirmada ÷ comentários recebidos no período × 100. Sem comentários, a taxa fica indisponível. Alcance único e seguidores não são somados entre dias ou plataformas. Contadores de vídeos não equivalem a comentários importados.</p></TabsContent>}
      <TabsContent value="integrations" className="space-y-4"><h2 className="text-lg font-semibold">Integrações</h2><div className="grid gap-4 md:grid-cols-3">{Object.entries(PLATFORMS).map(([key, label]) => <section key={key} className="rounded-xl border bg-white p-5 space-y-3"><h3 className="font-semibold">{label}</h3><p className="text-sm text-slate-500">Não conectado</p><p className="min-h-16 text-sm">{key === 'tiktok' ? 'Perfil e vídeos pela Display API. Comentários e respostas: Funcionalidade ainda não disponível nesta integração.' : 'Comentários, publicações e métricas dependem da conta elegível e das permissões oficiais.'}</p><Button variant="outline" disabled>Conectar {label}</Button><p className="text-xs text-slate-500">{permissions.configure ? 'Conexão OAuth será habilitada após revisão da fundação.' : 'Configuração restrita a administradores.'}</p></section>)}</div><section className="rounded-xl border bg-white p-5 space-y-3"><h3 className="font-semibold">IA · Não configurada</h3><p className="text-sm">Tom previsto: cordial, profissional, simpático e curto; português brasileiro, emojis moderados, sem discutir com o cliente.</p><p className="text-sm">Comentário → sugestão → revisão humana → aprovação → envio.</p><p className="text-sm text-amber-800">Reclamações e assuntos sensíveis exigem atenção humana. Respostas automáticas: DESATIVADO.</p></section></TabsContent>
    </Tabs>
    {selected && <CommentPanel key={selected.id} comment={selected} onClose={() => setSelected(null)} replies={data.replies} drafts={data.drafts} permissions={permissions} aiConfigured={data.aiConfigured} client={client}/>}
  </div>;
}
