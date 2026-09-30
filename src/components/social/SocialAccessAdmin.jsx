import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ShieldCheck, UserPlus, Pencil, Ban, RotateCcw, ArrowLeft, Plus } from 'lucide-react';
import {
  ACCOUNT_PERMISSION_FIELDS, ACCOUNT_PERMISSION_LABEL, ACCOUNT_PERMISSION_HINT,
  ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_BADGE,
  ACCESS_NOT_CONFIGURED_MESSAGE,
  normalizeAccountPermissions, describePermissionChange,
  accountLabel, redactExternalId, personLabel, isUserActive,
} from '@/lib/social/accountAccess';

// Tela de gestão de acessos. Só APARECE para quem tem `configure`; a segurança
// real está no backend, que revalida `configure` + `can_admin` em TODA operação
// (ver `server/social/accountAdmin.mjs`). Esconder o botão não é autorização —
// é apenas não oferecer o que seria recusado.
export default function SocialAccessAdmin({ client, canConfigure, canAdmin = false }) {
  const [accounts, setAccounts] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [access, setAccess] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadAccounts = async () => {
    setPending(true); setError(null);
    try {
      setAccounts(await client.listAccounts());
    } catch (e) {
      // "Schema não aplicado" e "sem permissão" são situações diferentes e
      // precisam de mensagens diferentes: a primeira é tarefa pendente, a
      // segunda é uma negação.
      if (e?.code === 'ACCESS_SCHEMA_NOT_READY') setAccounts('pending');
      else { setAccounts([]); setError(e?.message || 'Não foi possível carregar as contas.'); }
    } finally { setPending(false); }
  };
  useEffect(() => { if (canConfigure) loadAccounts(); }, [canConfigure]);

  const loadAccess = async (conta) => {
    setPending(true); setError(null);
    try {
      const [links, people] = await Promise.all([client.listAccountAccess(conta.id), client.listCandidates(conta.id)]);
      setAccess(links); setCandidates(people);
    } catch (e) { setAccess([]); setError(e?.message || 'Não foi possível carregar os acessos.'); }
    finally { setPending(false); }
  };
  useEffect(() => { if (selected) loadAccess(selected); }, [selected]);

  if (!canConfigure) return null;

  // Estado PENDENTE é distinto de "nenhuma conta cadastrada": dizer "vazio"
  // quando a tabela nem existe levaria o operador a concluir que não há contas.
  if (accounts === 'pending') {
    return <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="w-4 h-4 text-amber-500" /> Acesso às contas sociais</CardTitle></CardHeader>
      <CardContent><Alert>
        <AlertTitle>Configuração pendente</AlertTitle>
        <AlertDescription>
          {ACCESS_NOT_CONFIGURED_MESSAGE} A estrutura de acessos é criada uma única vez pelo administrador do banco;
          depois disso, conceder e revogar acesso é feito por aqui.
        </AlertDescription>
      </Alert></CardContent>
    </Card>;
  }

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Acesso às contas sociais</CardTitle>
      <p className="text-sm text-slate-500">Quem pode visualizar, responder, aprovar sugestões da IA e administrar cada conta.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      {pending && !selected && <p className="text-sm text-slate-500">Carregando contas…</p>}

      {!pending && accounts?.length === 0 && (
        <Alert>
          <AlertTitle>Nenhuma conta cadastrada</AlertTitle>
          <AlertDescription>
            Nenhuma conta social foi conectada ainda. As contas aparecem aqui quando uma integração oficial for
            conectada — esta tela não cria nem inventa contas.
          </AlertDescription>
        </Alert>
      )}

      {accounts?.length > 0 && !selected && <ul className="divide-y rounded-lg border">
        {accounts.map((conta) => <li key={conta.id} className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex-1 min-w-40">
            <p className="font-medium truncate">{accountLabel(conta)}</p>
            <p className="text-xs text-slate-500">ID externo: {redactExternalId(conta.external_account_id)}</p>
          </div>
          <Badge variant={ACCOUNT_STATUS_BADGE[conta.status] || 'secondary'}>{ACCOUNT_STATUS_LABEL[conta.status] || conta.status}</Badge>
          <span className="text-xs text-slate-500 whitespace-nowrap">{conta.access_count} {conta.access_count === 1 ? 'pessoa' : 'pessoas'}</span>
          <Button size="sm" variant="outline" disabled={!canAdmin} onClick={() => setSelected(conta)}>Gerenciar</Button>
        </li>)}
      </ul>}

      {selected && <AccountAccessPanel
        account={selected} access={access} candidates={candidates} client={client} busy={busy} setBusy={setBusy}
        notice={notice} setNotice={setNotice} onBack={() => { setSelected(null); loadAccounts(); }} onEdit={setEditing}
        onReload={() => loadAccess(selected)}
      />}

      {editing && <PermissionDialog
        entry={editing} client={client} onClose={() => setEditing(null)}
        onSaved={(mensagem) => { setEditing(null); setNotice(mensagem); loadAccess(selected); loadAccounts(); }}
      />}
    </CardContent>
  </Card>;
}

// Escolher a pessoa por NOME, nunca digitando UUID. O `auth_user_id` viaja
// junto com o rótulo, e quem já tem vínculo aparece desabilitado — porque
// duplicar violaria `unique (account_id, auth_user_id)`.
function AddUserDialog({ account, candidates, existing, client, busy, onClose, onDone }) {
  const jaVinculados = new Set(existing.map((l) => l.auth_user_id));
  const [escolhido, setEscolhido] = useState('');
  const [permissoes, setPermissoes] = useState({ can_view: true, can_reply: false, can_approve_ai: false, can_admin: false });
  const [erro, setErro] = useState(null);
  const normalized = useMemo(() => normalizeAccountPermissions(permissoes, true), [permissoes]);
  const pessoa = candidates.find((c) => c.auth_user_id === escolhido);
  const inativo = pessoa && !pessoa.active;

  const confirmar = async () => {
    setErro(null);
    try {
      await client.grant({ accountId: account.id, authUserId: escolhido, permissions: normalized.permissions });
      onDone(`Acesso concedido a ${personLabel(pessoa)}.`);
    } catch (e) { setErro(e?.message || 'Não foi possível conceder acesso.'); }
  };

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Adicionar usuário</DialogTitle>
        <DialogDescription>{accountLabel(account)}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Pessoa</Label>
          <Select value={escolhido} onValueChange={setEscolhido}>
            <SelectTrigger><SelectValue placeholder="Selecione por nome" /></SelectTrigger>
            <SelectContent>
              {candidates.length === 0 && <SelectItem value="__vazio" disabled>Nenhum usuário disponível</SelectItem>}
              {candidates.map((c) => <SelectItem key={c.auth_user_id} value={c.auth_user_id} disabled={jaVinculados.has(c.auth_user_id) || !c.active}>
                {personLabel(c)}{jaVinculados.has(c.auth_user_id) ? ' — já tem vínculo' : c.active ? '' : ' — inativo'}
              </SelectItem>)}
            </SelectContent>
          </Select>
          {inativo && <p className="text-xs text-amber-700">Este usuário está inativo no sistema e não pode receber acesso.</p>}
        </div>

        <PermissionCheckboxes value={permissoes} onChange={setPermissoes} />

        {normalized.adjusted.length > 0 && <Alert>
          <AlertTitle>Permissões ajustadas</AlertTitle>
          <AlertDescription>Para respeitar as regras do sistema: {normalized.adjusted.join(', ')}.</AlertDescription>
        </Alert>}
        {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={!escolhido || busy || inativo} onClick={confirmar}>
          <Plus className="w-4 h-4" /> Conceder acesso
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}


// As quatro caixas de permissão. A UI NÃO permite montar uma combinação que o
// banco rejeitaria: `normalizeAccountPermissions` (a mesma função do backend)
// completa as permissões decorrentes e a tela mostra o que foi ajustado.
function PermissionCheckboxes({ value, onChange }) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium">Permissões nesta conta</legend>
    {ACCOUNT_PERMISSION_FIELDS.map((field) => <label key={field} className="flex items-start gap-2">
      <Checkbox
        checked={value[field] === true}
        onCheckedChange={(checked) => onChange({ ...value, [field]: checked === true })}
        aria-label={ACCOUNT_PERMISSION_LABEL[field]}
      />
      <span className="text-sm">
        {ACCOUNT_PERMISSION_LABEL[field]}
        <span className="block text-xs text-slate-500">{ACCOUNT_PERMISSION_HINT[field]}</span>
      </span>
    </label>)}
  </fieldset>;
}

// Edição e reativação compartilham o diálogo: as permissões são as mesmas, o
// que muda é a operação chamada e a necessidade de confirmação. O botão pede
// confirmação antes de gravar — reativar e revogar são as duas ações que
// mudam quem enxerga o quê.
function PermissionDialog({ entry, client, onClose, onSaved }) {
  const [permissoes, setPermissoes] = useState(() => Object.fromEntries(ACCOUNT_PERMISSION_FIELDS.map((f) => [f, entry[f] === true])));
  const [erro, setErro] = useState(null);
  const [confirmado, setConfirmado] = useState(false);
  const reactivando = entry.reactivating === true;
  const normalized = useMemo(() => normalizeAccountPermissions(permissoes, reactivando ? true : entry.active), [permissoes, entry.active, reactivando]);
  const mudancas = useMemo(() => describePermissionChange(entry, normalized.permissions), [entry, normalized.permissions]);

  const salvar = async () => {
    setErro(null);
    try {
      if (reativando) {
        await client.reactivate({ accountId: entry.account_id, authUserId: entry.auth_user_id, permissions: normalized.permissions });
        onSaved(`Acesso de ${entry.display} foi reativado.`);
      } else {
        await client.saveAccess({ accountId: entry.account_id, authUserId: entry.auth_user_id, permissions: normalized.permissions, active: entry.active });
        onSaved(`Permissões de ${entry.display} atualizadas.`);
      }
    } catch (e) { setErro(e?.message || 'Não foi possível salvar as permissões.'); }
  };

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{reativando ? 'Reativar acesso' : 'Editar permissões'}</DialogTitle>
        <DialogDescription>{entry.display}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {!entry.active && !reativando && <Alert>
          <AlertTitle>Vínculo revogado</AlertTitle>
          <AlertDescription>Editar permissões não devolve acesso. Use "Reativar" para isso.</AlertDescription>
        </Alert>}
        <PermissionCheckboxes value={permissoes} onChange={setPermissoes} />
        {normalized.adjusted.length > 0 && <Alert>
          <AlertTitle>Permissões ajustadas</AlertTitle>
          <AlertDescription>Para respeitar as regras do sistema: {normalized.adjusted.join(', ')}.</AlertDescription>
        </Alert>}
        {mudancas.length > 0 && <div className="text-sm">
          <p className="font-medium">Resumo da alteração</p>
          <ul className="mt-1 list-disc pl-5 text-slate-600">
            {mudancas.map((m) => <li key={m.field}>{m.label}: {m.from ? 'sim' : 'não'} → {m.to ? 'sim' : 'não'}</li>)}
          </ul>
        </div>}
        {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={!confirmado} onClick={() => (confirmado ? salvar() : setConfirmado(true))}>
          {confirmado ? (reactivando ? 'Confirmar reativação' : 'Confirmar alteração') : (reactivando ? 'Reativar acesso' : 'Salvar alterações')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function AccountAccessPanel({ account, access, candidates, client, busy, setBusy, notice, setNotice, onBack, onEdit, onReload }) {
  const [adding, setAdding] = useState(false);
  const run = async (acao, mensagem) => {
    setBusy(true); setNotice(null);
    try { await acao(); setNotice(mensagem); }
    catch (e) { setNotice(e?.message || 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4" /> Voltar</Button>
      <p className="font-medium">{accountLabel(account)}</p>
      <Button size="sm" className="ml-auto" disabled={busy} onClick={() => setAdding(true)}><UserPlus className="w-4 h-4" /> Adicionar usuário</Button>
    </div>

    {access.length === 0 && <Alert><AlertTitle>Ninguém tem acesso a esta conta</AlertTitle>
      <AlertDescription>Conceda acesso para que a equipe possa ver e responder os comentários desta conta.</AlertDescription></Alert>}

    <ul className="divide-y rounded-lg border">
      {access.map((linha) => {
        const pessoa = candidates.find((c) => c.auth_user_id === linha.auth_user_id) || linha;
        return <li key={linha.auth_user_id} className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex-1 min-w-40">
            <p className="font-medium">{personLabel(pessoa)}</p>
            <p className="text-xs text-slate-500">
              {isUserActive(pessoa.status) ? pessoa.status || 'ativo' : `usuário inativo (${pessoa.status})`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {ACCOUNT_PERMISSION_FIELDS.filter((f) => linha[f]).map((f) => <Badge key={f} variant="secondary">{ACCOUNT_PERMISSION_LABEL[f]}</Badge>)}
            {!ACCOUNT_PERMISSION_FIELDS.some((f) => linha[f]) && <span className="text-xs text-slate-500">sem permissões</span>}
          </div>
          <Badge variant={linha.active ? 'default' : 'secondary'}>{linha.active ? 'Ativo' : 'Revogado'}</Badge>
          {!isUserActive(pessoa.status) && <Badge variant="destructive">Usuário inativo</Badge>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit({ ...linha, person: pessoa, account_id: account.id, display: personLabel(pessoa) })}>
            <Pencil className="w-3 h-3" /> Editar
          </Button>
          {linha.active
            ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => client.revoke({ accountId: account.id, authUserId: linha.auth_user_id }), `Acesso de ${personLabel(pessoa)} foi revogado.`)}>
                <Ban className="w-3 h-3" /> Revogar
              </Button>
            : <Button size="sm" variant="ghost" disabled={busy} onClick={() => onEdit({ ...linha, person: pessoa, account_id: account.id, display: personLabel(pessoa), reactivating: true })}>
                <RotateCcw className="w-3 h-3" /> Reativar
              </Button>}
        </li>;
      })}
    </ul>

    {adding && <AddUserDialog
      account={account} candidates={candidates} existing={access} client={client} busy={busy}
      onClose={() => setAdding(false)} onReload={onReload}
      onDone={(mensagem) => { setAdding(false); setNotice(mensagem); onReload(); }}
    />}
  </div>;
}

