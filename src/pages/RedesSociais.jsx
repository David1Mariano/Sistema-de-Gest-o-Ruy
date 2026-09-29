import { useAuth } from '@/lib/AuthContext';
import { socialPermissions } from '@/lib/social/domain';
import SocialWorkspace from '@/components/social/SocialWorkspace';

export default function RedesSociais() {
  const { user } = useAuth();
  const permissions = socialPermissions(user?.role);
  if (!permissions.view) return <div className="rounded-xl border bg-white p-6"><h1 className="text-xl font-semibold">Redes Sociais</h1><p className="mt-2" role="alert">Sem permissão para visualizar este módulo.</p></div>;
  return <SocialWorkspace permissions={permissions}/>;
}
