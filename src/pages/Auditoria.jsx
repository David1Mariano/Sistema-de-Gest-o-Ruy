import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useUserRole } from '@/lib/useUserRole';
import { Input } from '@/components/ui/input';
import AuditTable from '@/components/auditoria/AuditTable';

export default function Auditoria() {
  const { isAdmin } = useUserRole();
  const [records, setRecords] = useState([]);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { if (isAdmin) base44.entities.AuditLog.list('-created_date', 1000).then((items) => { setRecords(items); setLoading(false); }); }, [isAdmin]);
  const filtered = useMemo(() => records.filter((item) => (!action || item.action === action) && (!search || [item.entity_type, item.field, item.reason, item.responsible_user].some((value) => value?.toLowerCase().includes(search.toLowerCase())))), [records, search, action]);
  if (!isAdmin) return <div className="rounded-xl border bg-card p-10 text-center"><h1 className="text-xl font-semibold">Acesso restrito</h1><p className="mt-2 text-muted-foreground">A auditoria exige permissão de administrador.</p></div>;
  return <div className="space-y-5"><header><p className="text-sm text-muted-foreground">Governança e rastreabilidade</p><h1 className="text-2xl font-semibold">Auditoria</h1></header><div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por área, campo ou responsável"/><select value={action} onChange={(event) => setAction(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Todas as ações</option><option value="criacao">Criação</option><option value="alteracao">Alteração</option><option value="exclusao_logica">Exclusão lógica</option><option value="registro_falta">Registro de falta</option></select></div>{loading ? <div className="py-16 text-center text-muted-foreground">Carregando auditoria...</div> : <AuditTable records={filtered}/>}</div>;
}