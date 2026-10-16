import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {domainFields} from '../../server/d1-lab/domain-contract.mjs';
import {catalogFields} from '../../server/d1-lab/catalog-contract.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),main=await fs.readFile(path.join(root,'lab/d1/main.jsx'),'utf8');
const supported=new Set(['Sector','JobRole','StockMovement',...Object.keys(domainFields),...Object.keys(catalogFields)]);
const sources=new Map();
async function inspect(file){
 if(sources.has(file))return sources.get(file);
 const code=await fs.readFile(path.join(root,file),'utf8');
 const lineAt=index=>code.slice(0,index).split('\n').length;
 const entities=[...code.matchAll(/(?:base44|api)\.entities\.(\w+)\.(\w+)/g)].map(m=>({entity:m[1],method:m[2],line:lineAt(m.index),adapterKnown:supported.has(m[1]),acceptance:'static-contract-only; verify fields and aggregate semantics'}));
 const controls=[...code.matchAll(/<(Button|button|form|Input|input|select|Select|Textarea|textarea)\b[\s\S]*?>/g)].map(m=>({kind:m[1],line:lineAt(m.index),tag:m[0].replace(/\s+/g,' ').slice(0,350),status:'manual-or-specific-test-required'}));
 const cloud=[...code.matchAll(/supabase\.[\w.]+|(?:base44\.)?(?:integrations|functions)\.[\w.]+|https:\/\/[^\s'"`)]+/g)].map(m=>({call:m[0],line:lineAt(m.index)}));
 const imports=[];
 for(const match of code.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
  const spec=match[1];if(!spec.startsWith('@/')&&!spec.startsWith('.'))continue;
  const base=spec.startsWith('@/')?'src/'+spec.slice(2):path.posix.join(path.posix.dirname(file),spec.replaceAll('\\','/'));
  for(const candidate of [base,base+'.jsx',base+'.js',base+'.mjs',base+'/index.jsx',base+'/index.js']){
   try{if((await fs.stat(path.join(root,candidate))).isFile()&&/\.(?:jsx?|mjs)$/.test(candidate)){imports.push(candidate);break;}}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}
  }
 }
 const result={file,entities,controls,cloud,imports};sources.set(file,result);return result;
}
const notes={
 Setores:'CRUD e renomeação com impacto/versionamento locais; escopo sintético por usuário.',Funcoes:'Cadastro/consulta/edição e vínculo ao setor locais.',
 Funcionarios:'Cadastro/consulta/edição locais; anexos privados, exclusão e autorização empresarial incompletos.',Configuracoes:'Contrato SystemSettings parcial; usuários/credenciais empresariais não administráveis offline.',
 Vales:'Contrato F: criar/editar/cancelar, desconto vinculado e histórico locais; lote financeiro de vales bloqueado.',Consumo:'Contrato F local, estados e desconto de folha; não representa baixa de insumos.',
 Estoque:'Cadastro e movimentos locais portados; uploads/exportações e todas as rotinas não homologados.',Producao:'Ficha, rascunho, conferência/consumo/cancelamento agregados locais; escopo parcial.',
 Financeiro:'Pagamento individual e múltiplo atômico; despesas/contas portadas. Lote específico de vales, comprovantes, estornos e fechamento global limitados.',
 ReceitasFinanceiras:'Receita manual, contas/recebíveis e repasses delivery locais; não constitui venda, comanda ou pedido delivery.',RelatorioFinanceiro:'Fontes locais parciais; relatório integral/exportação no Electron não homologados.',
};
const pages=[];
for(const name of (await fs.readdir(path.join(root,'src/pages'))).filter(n=>n.endsWith('.jsx')).sort()){
 const page=name.slice(0,-4),file='src/pages/'+name,visited=new Set();
 async function walk(file){if(visited.has(file))return;visited.add(file);for(const dependency of (await inspect(file)).imports)await walk(dependency);}
 await walk(file);
 const wired=main.includes("@/pages/"+page+"'");
 pages.push({page,file,wiredInD1:wired,status:wired?'parcial-com-contratos-locais':'indisponivel-no-D1',notes:notes[page]||'Sem rota D1 oficial integrada; auth, entidades, serviços, ações e relatórios não presumidos locais.',localOverride:['Vales','Consumo'].includes(page)?'lab/d1/'+page+'.jsx':null,dependencies:[...visited],unsupportedEntities:[...new Set([...visited].flatMap(f=>sources.get(f).entities.filter(e=>!e.adapterKnown).map(e=>e.entity)))]});
}
const evidence={purpose:'RUY_ETAPA_I_STATIC_ALL_OFFICIAL_PAGES_AUDIT',generatedAt:new Date().toISOString(),coverage:'All src/pages JSX and recursively resolved local JS imports; control inventory is static, not end-to-end approval.',pages,sources:[...sources.values()],missingOfficialScreens:['Vendas','Comandas','Pedidos delivery'].filter(label=>!pages.some(p=>p.page.toLowerCase().includes(label.toLowerCase()))),limitations:['Dynamic entity names and handler expressions require manual review.','Known entity does not guarantee all fields or multi-record flows are supported.','Official pages not routed in D1 cannot be claimed operational.','Electron downloads and private attachment flows remain restricted.']};
await fs.writeFile(path.join(root,'docs/matriz-etapa-i-offline.json'),JSON.stringify(evidence,null,2)+'\n');
const table=pages.map(p=>`| ${p.page} | ${p.wiredInD1?'Parcial':'Indisponível'} | ${p.notes} |`).join('\n');
await fs.writeFile(path.join(root,'docs/matriz-etapa-i-offline.md'),`# Matriz de telas e funcionalidades — Etapa I\n\nAuditoria estática de ${pages.length} telas oficiais e ${sources.size} arquivos locais relacionados. Inventário completo de botões, formulários, campos, chamadas e linhas em [JSON](matriz-etapa-i-offline.json). Não equivale a clique/teste de todos os controles. Nenhum módulo inteiro é declarado totalmente homologado: os fluxos concluídos são discriminados abaixo.\n\n| Tela oficial | Situação como módulo completo | Fluxos locais e lacunas |\n|---|---|---|\n${table}\n\nVendas, comandas e pedidos delivery não possuem telas dedicadas encontradas em src/pages. Repasse financeiro delivery não é operação de pedido. Auth/Storage/Supabase operacionais continuam desconectados. Menus sem rota exibem bloqueio, não um módulo vazio aprovado.\n\nFluxos locais concluídos dentro do laboratório: CRUD de setores/funções; contratos de colaborador; vales/consumo individuais com histórico e vínculo ao desconto; pagamentos múltiplos pelo formulário oficial (Etapa I); movimentos de estoque e agregados de produção/financeiro já portados. Autorização efetiva atual: admin ativo para domínio/RH, escopo por proprietário; writer/reader restritos nos demais contratos. Não há delegação empresarial granular homologada.\n\nCampos/ações de arquivos privados, documentos, integrações, exportação/download, fechamento global, lote específico de vales, estornos e administração empresarial permanecem pendentes ou bloqueados mesmo quando a tela usa uma entidade conhecida. Filtros são locais somente sobre os registros efetivamente retornados pelo contrato; não indicam cobertura de fontes não portadas.\n`);
console.log(JSON.stringify({pages:pages.length,sources:sources.size,controls:evidence.sources.reduce((n,s)=>n+s.controls.length,0)}));
