import { useCurrentUser } from './useCurrentUser';

// Regras de acesso do RUY GESTÃO (seção 14/15)
// - Super Administrador / Administrador: acesso total, veem dados sensíveis
// - Gerente: vê operação, registra ocorrências; não vê dados financeiros sensíveis
// - Operacional (atendimento/producao/caixa/delivery): sem acesso geral ao RH
export function useUserRole() {
  const user = useCurrentUser();
  const role = user?.role || 'user';
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isManager = role === 'manager' || role === 'gerente' || isAdmin;
  // dados sensíveis: CPF, endereço, salário, dados bancários, documentos
  const canViewSensitive = isAdmin;
  const canManageEmployees = isAdmin || isManager;
  const canRegisterOccurrences = isAdmin || isManager;
  return { role, isAdmin, isManager, canViewSensitive, canManageEmployees, canRegisterOccurrences };
}