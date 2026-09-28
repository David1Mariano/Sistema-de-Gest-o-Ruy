import { Link } from 'react-router-dom';
import AuthLayout from '@/components/AuthLayout';
import { UserPlus } from 'lucide-react';
export default function Register() {
  return <AuthLayout icon={UserPlus} title="Acesso autorizado" subtitle="Solicite sua conta ao administrador" footer={<Link to="/login">Voltar ao login</Link>}>
    <p className="text-sm">O acesso é concedido pelo administrador. Colaboradores cadastrados no RH não são automaticamente usuários do sistema.</p>
  </AuthLayout>;
}
