import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { NAV_GROUPS } from '@/lib/navigation';
import { Building2, LogOut } from 'lucide-react';

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const isActive = (item) => item.exact
    ? location.pathname === item.path
    : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);

  return (
    <>
      {open && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`fixed lg:sticky top-0 z-50 flex h-screen w-[280px] lg:w-64 shrink-0 flex-col bg-slate-950 text-slate-200 border-r border-slate-800 shadow-2xl lg:shadow-none transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-sm">
            <Building2 className="w-5 h-5 text-slate-950" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold text-white tracking-tight">RUY GESTÃO</p>
            <p className="text-[11px] text-slate-400">Ruy Caldo de Cana</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group, index) => (
            <div key={group.label} className={index ? 'mt-5' : ''}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-slate-500">{group.label}</p>
              <div className="space-y-1">
                {group.items.filter((item) => !item.roles || item.roles.includes(user?.role)).map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item);
                  return (
                    <NavLink
                      key={item.key}
                      to={item.path}
                      onClick={onClose}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                    >
                      <Icon className="w-[18px] h-[18px] shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center font-semibold uppercase">
              {(user?.full_name || user?.email || 'U').charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white truncate">{user?.full_name || 'Usuário'}</p>
              <p className="text-[11px] text-slate-400 truncate">{user?.email || ''}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </aside>
    </>
  );
}