import {
  LayoutDashboard, UserCircle, Users, Briefcase, Clock, CalendarDays,
  FileX2, Wallet, ShoppingBag, AlertTriangle, BadgeDollarSign,
  Landmark, ShoppingCart, Boxes, FileBarChart, Settings, Factory, Gauge, ShieldCheck,
} from 'lucide-react';

export const NAV_GROUPS = [
  {
    label: 'GESTÃO',
    items: [
      { key: 'inicio', label: 'Dashboard', path: '/', icon: LayoutDashboard, exact: true },
      { key: 'direcao', label: 'Direção', path: '/direcao', icon: Gauge, roles: ['admin', 'super_admin'] },
    ],
  },
  {
    label: 'PESSOAS',
    items: [
      { key: 'rh', label: 'RH', path: '/rh', icon: UserCircle },
      { key: 'colaboradores', label: 'Colaboradores', path: '/funcionarios', icon: Users },
      { key: 'setores', label: 'Setores', path: '/setores', icon: Briefcase },
      { key: 'funcoes', label: 'Funções', path: '/funcoes', icon: Briefcase },
      { key: 'ponto', label: 'Ponto', path: '/ponto', icon: Clock },
      { key: 'escalas', label: 'Escalas', path: '/escalas', icon: CalendarDays },
      { key: 'ocorrencias', label: 'Ocorrências', path: '/ocorrencias', icon: FileX2 },
      { key: 'vales', label: 'Vales', path: '/vales', icon: Wallet },
      { key: 'consumo', label: 'Consumo', path: '/consumo', icon: ShoppingBag },
      { key: 'advertencias', label: 'Advertências', path: '/advertencias', icon: AlertTriangle },
    ],
  },
  {
    label: 'FINANCEIRO',
    items: [
      { key: 'financeiro', label: 'Financeiro', path: '/financeiro', icon: BadgeDollarSign },
      { key: 'receitas', label: 'Receitas & Conciliação', path: '/receitas', icon: Landmark },
      { key: 'compras', label: 'Compras', path: '/compras', icon: ShoppingCart },
    ],
  },
  {
    label: 'OPERAÇÃO',
    items: [
      { key: 'estoque', label: 'Estoque', path: '/estoque', icon: Boxes },
      { key: 'producao', label: 'Produção', path: '/producao', icon: Factory, roles: ['admin', 'super_admin', 'gerente', 'manager', 'producao'] },
    ],
  },
  {
    label: 'CONTROLE',
    items: [
      { key: 'relatorios', label: 'Relatórios', path: '/relatorios', icon: FileBarChart },
      { key: 'auditoria', label: 'Auditoria', path: '/auditoria', icon: ShieldCheck, roles: ['admin', 'super_admin'] },
      { key: 'configuracoes', label: 'Configurações', path: '/configuracoes', icon: Settings },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export function currentNavItem(pathname) {
  return NAV_ITEMS.find((item) => item.exact ? pathname === item.path : pathname === item.path || pathname.startsWith(`${item.path}/`));
}