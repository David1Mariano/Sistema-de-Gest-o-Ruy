import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderPlus, Loader2, Tag, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import {
  findEquivalentCategory, normalizeCategoryName, selectableCategories,
} from '@/lib/expenseCategories';

// Rede lenta não pode travar a tela: nenhuma espera aqui é infinita.
const TIMEOUT_MS = 15000;
const comTempoLimite = (promise, mensagem) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(mensagem)), TIMEOUT_MS)),
]);

// Cadastro de categorias DENTRO da área de Gastos Diários.
//
// A gravação usa a entity central `ExpenseCategory` — a mesma que o Financeiro
// já consome — então a categoria criada aqui existe para as demais máquinas
// autorizadas, continua salva ao reabrir o sistema e NÃO exige migration.
//
// Não há exclusão física: se a categoria já foi usada em algum gasto, só
// desativamos (status), preservando o histórico e as descrições gravadas.
//
// TRAVAMENTO (bug real, CAUSA RAIZ): o componente renderiza
// `selectableCategories(categories)`, que faz `[...(categories || [])]`. Quando
// `categories` chega como OBJETO (não lista) — e não como `undefined`, onde o
// default `= []` segura — o spread estoura: "is not iterable". Sem Error
// Boundary, o React desmonta a árvore inteira: TELA BRANCA travada.
//
// Isto NÃO era o aviso de "controlled/uncontrolled": aquele só avisa, não joga a
// tela fora. Foi reproduzido com `renderToStaticMarkup` — `value={undefined}`
// passa, `categories` não-array estoura.
//
// De onde vem o objeto: `DailyExpensesPanel` repassa `data.categories` direto, e
// o `Financeiro.jsx` monta o painel SEM `onCategoriesChanged`, então o `onSaved`
// do Gerenciador cai no `load()` completo, que regrava o `data` inteiro.
//
// A correção é na BORDA (não mascarando): aceitar lista, rejeitar o resto, e o
// chamador nunca receber um id que não existe.
export default function ExpenseCategoryManager({ categories = [], onSaved, onSelect }) {
  // Normaliza na entrada: `Array.isArray` é a única fonte de verdade sobre o
  // que é lista. Qualquer outra coisa (undefined, objeto, null) vira lista vazia
  // em vez de derrubar o render.
  const lista = selectableCategories(Array.isArray(categories) ? categories : []);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Guarda síncrona: impede duas persistências concorrentes.
  const busy = useRef(false);

  // Se a tela for desmontada com uma gravação em voo, não mexemos mais no estado.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const avisar = (fn) => { if (mounted.current) fn(); };

  const create = useCallback(async () => {
    if (busy.current) return; // já está salvando: ignora o segundo disparo
    const limpo = normalizeCategoryName(name);
    if (!limpo) { setError('Informe o nome da categoria.'); return; }

    busy.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const equivalente = findEquivalentCategory(categories, limpo);
      if (equivalente) {
        // "Limpeza" x " LIMPEZA " = mesma categoria: reaproveitamos a existente
        // em vez de duplicar. Só reativamos uma vez e encerramos.
        if (equivalente.status !== 'ativo') {
          await comTempoLimite(
            base44.entities.ExpenseCategory.update(equivalente.id, { status: 'ativo' }),
            'Tempo esgotado ao reativar a categoria. Tente novamente.',
          );
          avisar(() => setMessage(`Categoria "${equivalente.name}" já existia e foi reativada.`));
        } else {
          avisar(() => setMessage(`"${equivalente.name}" já existe. Categorias iguais não são duplicadas.`));
        }
      } else {
        const criada = await comTempoLimite(
          base44.entities.ExpenseCategory.create({ name: limpo, group: 'operacao', status: 'ativo' }),
          'Tempo esgotado ao criar a categoria. Tente novamente.',
        );
        avisar(() => setName(''));
        avisar(() => setMessage(`Categoria "${limpo}" criada. Já aparece na lista de gastos.`));
        // O `onSaved` vem ANTES da seleção: só assim a categoria já existe no
        // `<select>` quando recebe o id. Selecionar antes deixava o valor
        // apontando para uma opção que ainda não estava na lista.
        await onSaved?.();
        // Só seleciona com id REAL. `undefined` aqui virava estado `undefined`
        // no select do pai — controlado sem `value`, o React reclamava.
        const novoId = criada?.id;
        if (novoId) avisar(() => onSelect?.(novoId));
        return;
      }
      // Recarrega SÓ as categorias; não derruba a tela de gastos.
      await onSaved?.();
    } catch (e) {
      avisar(() => setError(e?.message || 'Não foi possível criar a categoria. Tente novamente.'));
    } finally {
      busy.current = false;
      avisar(() => setSaving(false));
    }
  }, [categories, name, onSaved, onSelect]);

  const toggle = useCallback(async (category) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const novo = category.status === 'ativo' ? 'inativo' : 'ativo';
      await comTempoLimite(
        base44.entities.ExpenseCategory.update(category.id, { status: novo }),
        'Tempo esgotado ao atualizar a categoria. Tente novamente.',
      );
      await onSaved?.();
    } catch (e) {
      avisar(() => setError(e?.message || 'Não foi possível atualizar a categoria.'));
    } finally {
      busy.current = false;
      avisar(() => setSaving(false));
    }
  }, [categories, onSaved]);

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
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
        placeholder="Nova categoria (ex.: Embalagens)"
        aria-label="Nome da nova categoria"
      />
      <Button type="button" onClick={create} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
        {saving ? 'Salvando...' : 'Nova categoria'}
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
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1 text-xs"
              disabled={saving}
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
