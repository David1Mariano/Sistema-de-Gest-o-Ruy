import { useState } from 'react';
import { FolderPlus, Loader2, Tag, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import {
  findEquivalentCategory, normalizeCategoryName, selectableCategories,
} from '@/lib/expenseCategories';

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

// Cadastro de categorias DENTRO da área de Gastos Diários.
//
// A gravação usa a entity central `ExpenseCategory` — a mesma que o Financeiro
// já consome — então a categoria criada aqui existe para as demais máquinas
// autorizadas, continua salva ao reabrir o sistema e NÃO exige migration.
//
// Não há exclusão física: se a categoria já foi usada em algum gasto, só
// desativamos (status), preservando o histórico e as descrições gravadas.
export default function ExpenseCategoryManager({ categories = [], onSaved, onSelect }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    const limpo = normalizeCategoryName(name);
    setError('');
    setMessage('');
    if (!limpo) { setError('Informe o nome da categoria.'); return; }

    const equivalente = findEquivalentCategory(categories, limpo);
    if (equivalente) {
      // "Limpeza" x " LIMPEZA " = mesma categoria: reaproveitamos a existente
      // (reativando se estiver desligada) em vez de duplicar.
      if (equivalente.status !== 'ativo') {
        setSaving(true);
        try {
          await base44.entities.ExpenseCategory.update(equivalente.id, { status: 'ativo' });
          setMessage(`Categoria "${equivalente.name}" já existia e foi reativada.`);
          await onSaved();
        } catch (e) {
          setError(e?.message || 'Não foi possível reativar a categoria.');
        } finally { setSaving(false); }
        return;
      }
      setMessage(`"${equivalente.name}" já existe. Categorias iguais não são duplicadas.`);
      setName('');
      onSelect?.(equivalente.id);
      return;
    }

    setSaving(true);
    try {
      const criada = await base44.entities.ExpenseCategory.create({
        name: limpo, group: 'operacao', status: 'ativo',
      });
      setName('');
      setMessage(`Categoria "${limpo}" criada. Já aparece na lista de gastos.`);
      await onSaved();
      onSelect?.(criada?.id);
    } catch (e) {
      setError(e?.message || 'Não foi possível criar a categoria.');
    } finally { setSaving(false); }
  };

  const toggle = async (category) => {
    setError('');
    setMessage('');
    const novo = category.status === 'ativo' ? 'inativo' : 'ativo';
    try {
      await base44.entities.ExpenseCategory.update(category.id, { status: novo });
      await onSaved();
    } catch (e) {
      setError(e?.message || 'Não foi possível atualizar a categoria.');
    }
  };

  const lista = selectableCategories(categories);

  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center gap-2 mb-3">
      <Tag className="w-4 h-4 text-amber-600" />
      <h3 className="font-semibold text-slate-800">Categorias de gasto</h3>
    </div>
    <div className="flex flex-wrap gap-2">
      <Input
        className="h-9 flex-1 min-w-[180px]"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        placeholder="Nova categoria (ex.: Embalagens)"
        aria-label="Nome da nova categoria"
      />
      <Button onClick={create} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
        Nova categoria
      </Button>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-2 text-sm text-emerald-700">{message}</p>}
    {lista.length ? (
      <div className="mt-3 max-h-60 overflow-y-auto divide-y">
        {lista.map((category) => (
          <div key={category.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className={category.status === 'ativo' ? 'text-slate-800' : 'text-slate-400 line-through'}>
              {category.name}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-xs"
              onClick={() => toggle(category)}
            >
              {category.status === 'ativo' ? 'Desativar' : <><Check className="w-3 h-3" /> Reativar</>}
            </Button>
          </div>
        ))}
      </div>
    ) : (
      <p className="mt-3 text-sm text-slate-400">Nenhuma categoria cadastrada ainda.</p>
    )}
    <p className="mt-3 text-xs text-slate-400">
      Desativar não apaga nada: os gastos já lançados continuam com a categoria original.
    </p>
  </div>;
}
