# Wiring do Delivery na `agente-1` (aplicar via cherry-pick depois)

Os arquivos novos já existem e são autossuficientes. Faltam 3 inserções mínimas
(1 linha cada) para ativar. NÃO aplicar nesta worktree suja — aplicar no
cherry-pick para `agente-1@48fd752`.

## 1. `src/api/base44Client.js` — registrar 9 entidades

No array `ENTITY_NAMES`, acrescentar:

```js
'DeliveryOrder', 'DeliveryOrderItem', 'DeliveryCustomer', 'DeliveryAddress',
'DeliveryDriverAssignment', 'DeliveryPayment', 'DeliveryFee',
'DeliveryAuditEvent',
```

(`DeliverySettlement` já existe no array — manter.)

## 2. `src/lib/navigation.js` — aba DELIVERY

No grupo OPERAÇÃO, antes de `estoque`:

```js
{ key: 'delivery', label: 'Delivery', path: '/delivery', icon: Bike },
```

E importar `Bike` do lucide-react (já usado em Financeiro — copiar o import).

## 3. `src/App.jsx` — rota

```js
import Delivery from '@/pages/Delivery';
<Route path="/delivery" element={<Delivery />} />
```

## 4. `package.json` — script de teste

```json
"test:delivery": "node scripts/test-delivery.mjs",
```

## Ordem de homologação (Etapa F)

1. `node scripts/test-delivery.mjs` (isolado, sem backend)
2. `npm run test:delivery` (via script)
3. `npx eslint src/lib/delivery src/pages/Delivery.jsx src/components/delivery scripts/test-delivery.mjs --quiet`
4. `npm run build`
5. Testes oficiais existentes (estoque/financeiro) sem regressão
6. Teste manual: /delivery → 8 abas → novo pedido → avançar → cancelar com motivo → CSV → import CSV
