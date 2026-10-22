import {NAV_GROUPS} from '../../src/lib/navigation.js';
import {BadgeDollarSign,Package,Paperclip,ShieldCheck,Wallet} from 'lucide-react';
export function windowsNavigation({attendance=false,payroll=false,role}={}){
 const available=new Set(['inicio','direcao','redes-sociais','ocorrencias','advertencias','rh','colaboradores','setores','funcoes','financeiro','receitas','estoque','producao','relatorios','configuracoes','vales','consumo','auditoria']);
 if(attendance){available.add('ponto');available.add('escalas');}
 const reasons={ponto:'Este perfil histórico não contém registros de ponto. Operação requer um perfil separado com jornada habilitada.',escalas:'Não foram recuperadas escalas; não serão criados registros automaticamente.',compras:'Recebimento de compra exige um comando atômico de itens, estoque e contas a pagar; a tela antiga não atende esse contrato.'};
 const groups=NAV_GROUPS.map(g=>({...g,items:g.items.filter(i=>!i.roles||i.roles.includes(role)).map(i=>({...i,disabled:!available.has(i.key),disabledLabel:['ponto','escalas'].includes(i.key)?'Sem fonte de jornada':undefined,reason:reasons[i.key]||'Este fluxo ainda não foi homologado com a API Windows.'}))}));
 groups.find(g=>g.label==='PESSOAS').items.push({key:'folha',label:'Folha de pagamento',path:'/folha',icon:BadgeDollarSign,disabled:!payroll,disabledLabel:'Requer perfil operacional',reason:'Cálculo e fechamento homologados em dados sintéticos; pagamento e reabertura ainda não habilitados.'});
 groups[2].items.push({key:'caixa',label:'Caixa',path:'/caixa',icon:Wallet});
 groups[3].items.push({key:'delivery',label:'Delivery',path:'/delivery-lab',icon:Package});
 groups[4].items.push({key:'anexos',label:'Anexos e comprovantes',path:'/anexos',icon:Paperclip});
 if(role==='admin')groups[4].items.push({key:'acessos',label:'Usuários e permissões',path:'/acessos',icon:ShieldCheck});
 return groups;
}
