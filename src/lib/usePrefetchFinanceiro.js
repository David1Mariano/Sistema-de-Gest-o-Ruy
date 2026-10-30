import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { FONTE_FINANCEIRO } from '@/lib/financeiroLoad';
import { prefetch } from '@/lib/financeiroPrefetch';

// No startup, antecipar somente categorias. FinancialExpense pode carregar
// anexos grandes e deve ser consultada apenas ao entrar no Financeiro.
const ALVOS = ['categories'];

const ORDEM = { ExpenseCategory: 'name' };
const LIMITE = { ExpenseCategory: 300 };

/**
 * Um único gatilho de prefetch, disparado uma vez por sessão do navegador.
 *
 * Por que aqui e não em cada tela: prefetch espalhado em vários componentes
 * vira prefetch duplicado, e prefetch duplicado é a forma mais cara de
 * "acelerar" alguma coisa. Este é o ponto central que já existe no app.
 *
 * Por que no tempo ocioso: se a busca sair junto com o primeiro render, ela
 * rouba a banda da tela que a pessoa está tentando ver. `requestIdleCallback`
 * só roda quando o navegador não tem nada melhor para fazer.
 */
export function usePrefetchFinanceiro() {
  const disparou = useRef(false);

  useEffect(() => {
    if (disparou.current) return;
    disparou.current = true;

    const buscar = async (alias) => {
      const fonte = FONTE_FINANCEIRO.find((f) => f.alias === alias);
      if (!fonte) return [];
      const cliente = base44.entities[fonte.entity];
      return cliente.list(ORDEM[fonte.entity] || fonte.sort, LIMITE[fonte.entity] || fonte.limit);
    };

    const rodar = () => { prefetch(ALVOS, buscar); };

    // O idle é o caminho preferido; o timeout cobre navegadores sem a API.
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(rodar, { timeout: 2500 });
      return () => cancelIdleCallback?.(id);
    }
    const id = setTimeout(rodar, 1200);
    return () => clearTimeout(id);
  }, []);
}
