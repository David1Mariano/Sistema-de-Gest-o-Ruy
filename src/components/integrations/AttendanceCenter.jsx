import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { RefreshCw, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deliveryCall } from '@/lib/integrations/deliveryClient';
import { CHANNELS } from '@/lib/delivery/domain';
import {
  OWNER_FILTERS, attendanceReducer, conversationView, draftKey, filterConversations,
  handoffAvailability, initialAttendance, messageLabel, orderMessages, readDraft, replyState,
  saveDraft, sortConversations, unreadBadge,
} from '@/lib/delivery/attendance';

// Central de Atendimento: lista, painel de mensagens, handoff, perfil e auditoria.
// Permissão de gestão vem do servidor (canManage por loja); o navegador só reflete.
export default function AttendanceCenter({ session, scopes, actorId, scopesError, aiConfigured = false, seedSearch = '', seedNonce = 0 }) {
  const [state, dispatch] = useReducer(attendanceReducer, initialAttendance);
  const [permissions, setPermissions] = useState({});
  const [channel, setChannel] = useState('all'), [merchant, setMerchant] = useState('all');
  const [mode, setMode] = useState('all'), [owner, setOwner] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false), [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [messages, setMessages] = useState(null), [messagesError, setMessagesError] = useState(''), [messagesLoading, setMessagesLoading] = useState(false);
  const [audit, setAudit] = useState(null), [auditOpen, setAuditOpen] = useState(false), [auditError, setAuditError] = useState(''), [auditLoading, setAuditLoading] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false), [panelError, setPanelError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draftText, setDraftText] = useState(''), [draftSaved, setDraftSaved] = useState(false);

  // Atualização silenciosa: as linhas permanecem na tela durante o carregamento,
  // a seleção não é perdida e o erro nunca apaga o que já foi carregado.
  const loadConversations = useCallback(async () => {
    if (!scopes || !scopes.length) return;
    dispatch({ type: 'loading' });
    try {
      const merged = []; const nextPermissions = {};
      for (const scope of scopes) {
        let offset = 0;
        do {
          const page = await deliveryCall('conversations', { provider: scope.provider, merchantId: scope.merchant_id, offset });
          merged.push(...page.rows);
          nextPermissions[`${scope.provider}:${scope.merchant_id}`] = page.canManage;
          offset = page.nextOffset;
          if (merged.length > 5000) throw Error('Limite de conversas excedido. Atualize os filtros de loja.');
        } while (offset !== null);
      }
      setPermissions(nextPermissions);
      dispatch({ type: 'loaded', rows: sortConversations(merged) });
    } catch (e) { dispatch({ type: 'failed', error: e.message }); }
  }, [scopes]);

  useEffect(() => {
    if (scopes && scopes.length) loadConversations();
    else if (scopes && !scopes.length) dispatch({ type: 'loaded', rows: [] });
  }, [scopes, loadConversations, reload]);

  // Auto-atualização a cada 60s apenas da lista; a conversa aberta e os filtros ficam.
  useEffect(() => {
    if (!session || !scopes || !scopes.length) return undefined;
    const timer = setInterval(() => { loadConversations(); }, 60000);
    return () => clearInterval(timer);
  }, [session, scopes, loadConversations]);

  useEffect(() => { if (seedNonce) setSearch(seedSearch); }, [seedNonce, seedSearch]);

  const selectedRow = useMemo(() => (state.rows || []).find(row => row.id === state.selectedId) || null, [state.rows, state.selectedId]);
  const view = selectedRow ? conversationView(selectedRow, actorId) : null;
  const canManage = Boolean(view && permissions[`${view.provider}:${view.merchantId}`]);
  const availability = handoffAvailability(view, canManage);

  const loadMessages = useCallback(async row => {
    setMessagesLoading(true); setMessagesError('');
    try {
      const collected = []; let offset = 0;
      do {
        const page = await deliveryCall('messages', { provider: row.provider, merchantId: row.merchant_id, conversationId: row.id, offset });
        collected.push(...page.rows);
        offset = page.nextOffset;
        if (collected.length > 5000) throw Error('Limite de mensagens excedido para esta conversa.');
      } while (offset !== null);
      setMessages(orderMessages(collected));
      // Marcar como lido persiste o marcador por operador no servidor, não só aqui.
      try {
        await deliveryCall('mark_read', { provider: row.provider, merchantId: row.merchant_id, conversationId: row.id });
        dispatch({ type: 'patch', id: row.id, changes: { unread_count: 0 } });
      } catch { /* marcador indisponível: o badge permanece até a próxima leitura */ }
    } catch (e) { setMessagesError(e.message); }
    finally { setMessagesLoading(false); }
  }, []);

  // Troca de conversa: limpa apenas o painel detalhado; a lista continua intacta.
  useEffect(() => {
    setMessages(null); setMessagesError(''); setAudit(null); setAuditOpen(false); setAuditError(''); setPanelError(''); setDraftSaved(false);
    if (selectedRow) {
      setDraftText(readDraft(window.localStorage, draftKey(selectedRow.provider, selectedRow.merchant_id, selectedRow.id)));
      loadMessages(selectedRow);
    } else setDraftText('');
    return () => { /* efeito da conversa selecionada */ };
  }, [state.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runHandoff = async mode => {
    if (!view) return;
    setHandoffBusy(true); setPanelError('');
    try {
      const result = await deliveryCall('handoff', { provider: view.provider, merchantId: view.merchantId, conversationId: view.id, version: view.version, mode });
      dispatch({ type: 'patch', id: view.id, changes: { mode: result.mode, version: result.version } });
      if (auditOpen) await loadAudit(view);
      await loadConversations();
    } catch (e) {
      // Aviso explícito sem apagar mensagens, perfil ou lista; versão antiga força releitura.
      setPanelError(e.message);
      if (e.code === 'CONVERSATION_CHANGED' || e.code === 'INVALID_HANDOFF_VERSION') await loadConversations();
    } finally { setHandoffBusy(false); }
  };

  async function loadAudit(row) {
    setAuditLoading(true); setAuditError('');
    try {
      const result = await deliveryCall('audit', { provider: row.provider, merchantId: row.merchant_id, conversationId: row.id });
      setAudit({ rows: result.rows, events: result.events || [] });
    } catch (e) { setAuditError(e.message); }
    finally { setAuditLoading(false); }
  }

  const toggleAudit = async () => {
    if (auditOpen) { setAuditOpen(false); return; }
    setAuditOpen(true);
    if (view && !audit) await loadAudit(view);
  };

  const saveLocalDraft = () => {
    if (!view) return;
    saveDraft(window.localStorage, draftKey(view.provider, view.merchantId, view.id), draftText);
    setDraftSaved(true);
  };

  const visible = filterConversations(state.rows || [], { channel, merchant, mode, owner, actorId, unreadOnly, search });
  const merchants = [...new Set((scopes || []).map(scope => scope.merchant_id))];
  const reply = replyState({ mode: view?.mode, aiConfigured });

  return <section className="space-y-4 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold">Conversas</h2>
        <p className="text-xs text-slate-500">Leitura, handoff auditado e rascunho local. Nenhuma mensagem é enviada por esta tela.</p>
      </div>
      <Button variant="outline" disabled={!session || state.loading} onClick={() => setReload(value => value + 1)}>
        <RefreshCw size={16} /> Atualizar
      </Button>
    </div>

    <div className="flex flex-wrap gap-3">
      <Input aria-label="Buscar conversas" className="w-64" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, telefone, ID ou conteúdo recente" />
      <select aria-label="Canal da conversa" className="rounded-md border px-3 text-sm" value={channel} onChange={e => setChannel(e.target.value)}>
        <option value="all">Todos os canais</option>
        {Object.entries(CHANNELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <select aria-label="Loja da conversa" className="rounded-md border px-3 text-sm" value={merchant} onChange={e => setMerchant(e.target.value)}>
        <option value="all">Todas as lojas</option>
        {merchants.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
      <select aria-label="Modo do atendimento" className="rounded-md border px-3 text-sm" value={mode} onChange={e => setMode(e.target.value)}>
        <option value="all">Humano e IA</option>
        <option value="human">Somente humano</option>
        <option value="ai">Somente IA</option>
      </select>
      <select aria-label="Responsável pelo atendimento" className="rounded-md border px-3 text-sm" value={owner} onChange={e => setOwner(e.target.value)}>
        {Object.entries(OWNER_FILTERS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" aria-label="Somente não lidas" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
        Somente não lidas
      </label>
    </div>
    <p className="text-xs text-slate-500">
      A conversa não tem estado &quot;aberta/finalizada&quot; no modelo atual, por isso esse filtro não existe.
      A lista se atualiza sozinha a cada 60s sem perder a conversa selecionada. Busca cobre nome, telefone, ID e conteúdo recente da conversa.
    </p>

    {scopesError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{scopesError}</p>}
    {state.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state.error} Os dados já carregados continuam visíveis.</p>}
    {!session && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Verifique seu acesso para consultar conversas.</p>}

    <div className="flex flex-col gap-3 xl:flex-row">
      <section aria-label="Lista de conversas" className="max-h-[70vh] shrink-0 space-y-2 overflow-auto xl:w-80">
        {state.rows === null && state.loading && <p role="status" className="text-sm text-slate-500">Carregando conversas...</p>}
        {state.rows === null && !state.loading && !state.error && session && <p className="text-sm text-slate-500">{scopes === null ? 'Aguardando escopos de atendimento...' : 'Nenhuma conversa carregada.'}</p>}
        {scopes && !scopes.length && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Nenhuma loja autorizada para atendimento. Peça a liberação do escopo ao administrador.</p>}
        {state.rows !== null && state.rows.length > 0 && !visible.length && <p className="text-sm text-slate-500">Nenhuma conversa corresponde aos filtros.</p>}
        {visible.map(row => {
          const item = conversationView(row, actorId);
          return <button key={row.id} type="button" aria-pressed={state.selectedId === row.id}
            onClick={() => dispatch({ type: 'select', id: row.id })}
            className={`w-full rounded-lg border p-3 text-left ${state.selectedId === row.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <div className="flex items-center justify-between gap-2">
              <strong className="truncate text-sm">{item.name || item.customerExternalId || item.externalId}</strong>
              {item.unread > 0 && <span className="rounded-full bg-orange-600 px-2 py-0.5 text-xs font-semibold text-white">{unreadBadge(item.unread)}</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">{CHANNELS[item.provider]} · {item.merchantId} · {item.modeLabel} · {item.ownerLabel}</p>
            <p className="mt-1 truncate text-sm text-slate-600">{item.lastBody || 'Sem mensagens registradas'}</p>
            <p className="mt-1 text-xs text-slate-400">{item.lastAt ? new Date(item.lastAt).toLocaleString('pt-BR') : '—'}</p>
          </button>;
        })}
        {state.loading && state.rows !== null && <p role="status" className="text-center text-xs text-slate-400">Atualizando...</p>}
      </section>

      {/* Coluna 2: painel de mensagens + resposta */}
      <section aria-label="Conversa aberta" className="min-w-0 flex-1 rounded-lg border p-4">
        {!view && <p className="py-10 text-center text-sm text-slate-500">Selecione uma conversa na lista para ler o histórico e registrar o handoff.</p>}
        {view && <>
          <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
            <div>
              <strong className="text-base">{view.name || view.customerExternalId || 'Cliente não identificado'}</strong>
              <p className="text-xs text-slate-500">
                {CHANNELS[view.provider]} · loja {view.merchantId} · conversa {view.externalId}
                {view.phone ? ` · ${view.phone}` : ' · telefone não informado'}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{view.modeLabel}</span>
                {' '}· versão {view.version} · responsável: {view.ownerLabel}{view.ownerShort ? ` (${view.ownerShort})` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!availability.allowed || handoffBusy} onClick={() => runHandoff('human')}>Assumir atendimento</Button>
              <Button variant="outline" disabled={!availability.allowed || handoffBusy} onClick={() => runHandoff('ai')}>Devolver para IA</Button>
              <Button variant="outline" onClick={toggleAudit}>Auditoria</Button>
              <Button variant="outline" aria-label="Abrir perfil do cliente" onClick={() => setDrawerOpen(open => !open)}><UserRound size={16} /></Button>
            </div>
          </div>
          {!canManage && <p className="mt-2 text-xs text-slate-500">Somente leitura nesta loja: assumir e devolver exige permissão de gestão concedida pelo servidor.</p>}
          {panelError && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{panelError}</p>}
          {handoffBusy && <p role="status" className="mt-2 text-xs text-slate-500">Registrando handoff...</p>}

          <div className="mt-3 max-h-[45vh] space-y-2 overflow-auto">
            {messagesLoading && !messages && <p role="status" className="text-sm text-slate-500">Carregando mensagens...</p>}
            {messagesError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{messagesError}</p>}
            {messages && !messages.length && <p className="text-sm text-slate-500">Nenhuma mensagem registrada nesta conversa.</p>}
            {messages && messages.length > 0 && <ol className="space-y-2">
              {messages.map(message => <li key={message.id}
                className={`rounded-lg border p-3 ${message.direction === 'inbound' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex justify-between gap-2 text-xs text-slate-500">
                  <span className={message.invalidated || message.status === 'invalidated' ? 'font-semibold text-red-700' : ''}>{messageLabel(message)}</span>
                  <span>{new Date(message.occurred_at).toLocaleString('pt-BR')}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{message.body}</p>
              </li>)}
            </ol>}
          </div>

          {/* Resposta: rascunho local; envio de mensagem não existe nesta fase. */}
          <div className="mt-3 border-t pt-3">
            <textarea aria-label="Resposta do atendente" rows={3} value={draftText}
              onChange={e => { setDraftText(e.target.value); setDraftSaved(false); }}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Escreva uma resposta (fica apenas neste navegador até o envio ser habilitado)" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={saveLocalDraft}>Salvar rascunho local</Button>
              <Button disabled title={reply.sendReason}>Envio ainda não habilitado</Button>
              {draftSaved && <span className="text-xs text-slate-500">Rascunho salvo neste navegador.</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">{reply.note}</p>
          </div>

          {auditOpen && <div className="mt-3 rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <strong className="text-sm">Histórico de atendimento</strong>
              <button type="button" aria-label="Fechar auditoria" onClick={() => setAuditOpen(false)}><X size={16} /></button>
            </div>
            {auditLoading && <p className="mt-2 text-xs text-slate-500">Carregando histórico...</p>}
            {auditError && <p role="alert" className="mt-2 text-sm text-red-700">{auditError}</p>}
            {audit && !audit.rows.length && !audit.events.length && <p className="mt-2 text-sm text-slate-600">Nenhum evento de atendimento registrado para esta conversa.</p>}
            {audit?.rows.map(row => <p key={row.id} className="mt-2 text-xs text-slate-700">
              {new Date(row.created_at).toLocaleString('pt-BR')} · {row.mode === 'ai' ? 'IA habilitada' : 'Atendimento humano'} · versão {row.version} ·{' '}
              {row.actor_id === actorId ? 'você' : `operador ${row.actor_id.slice(0, 8)}`}
            </p>)}
            {audit?.events.map((row, index) => <p key={`${row.created_at}-${index}`} className="mt-1 text-xs text-slate-600">
              {new Date(row.created_at).toLocaleString('pt-BR')} · {row.event_type} · mensagem {row.message_external_id}
            </p>)}
            <p className="mt-2 text-xs text-slate-500">
              Somente transições de handoff têm histórico persistido hoje. Mensagem recebida, rascunho criado e rascunho
              invalidado serão gravados quando a migration de eventos for revisada e aplicada — nada retroativo é exibido.
            </p>
          </div>}
        </>}
      </section>

      {/* Coluna 3: gaveta de perfil do cliente */}
      {drawerOpen && view && <aside aria-label="Perfil do cliente" className="shrink-0 space-y-2 rounded-lg border p-4 xl:w-72">
        <div className="flex items-center justify-between">
          <strong className="text-sm">Perfil do cliente</strong>
          <button type="button" aria-label="Fechar perfil" onClick={() => setDrawerOpen(false)}><X size={16} /></button>
        </div>
        <dl className="space-y-1 text-xs text-slate-700">
          <div><dt className="inline font-semibold">Nome: </dt><dd className="inline">{view.name || 'Não informado pelo canal'}</dd></div>
          <div><dt className="inline font-semibold">Telefone: </dt><dd className="inline">{view.phone || 'Não informado pelo canal'}</dd></div>
          <div><dt className="inline font-semibold">ID do cliente: </dt><dd className="inline">{view.customerExternalId || '—'}</dd></div>
          <div><dt className="inline font-semibold">Conversa: </dt><dd className="inline">{view.externalId}</dd></div>
          <div><dt className="inline font-semibold">Canal: </dt><dd className="inline">{CHANNELS[view.provider]}</dd></div>
          <div><dt className="inline font-semibold">Loja: </dt><dd className="inline">{view.merchantId}</dd></div>
          <div><dt className="inline font-semibold">Modo: </dt><dd className="inline">{view.modeLabel}</dd></div>
          <div><dt className="inline font-semibold">Responsável: </dt><dd className="inline">{view.ownerLabel}</dd></div>
          <div><dt className="inline font-semibold">Versão: </dt><dd className="inline">{view.version}</dd></div>
          <div><dt className="inline font-semibold">Última atualização: </dt><dd className="inline">{view.updatedAt ? new Date(view.updatedAt).toLocaleString('pt-BR') : '—'}</dd></div>
        </dl>
        <p className="text-xs text-slate-500">Nome e telefone só existem quando o provedor informa. O telefone não identifica nem associa clientes entre canais.</p>
      </aside>}
    </div>
  </section>;
}

