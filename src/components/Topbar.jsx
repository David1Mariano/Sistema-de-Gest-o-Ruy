import { Menu, Bell, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';

export default function Topbar({ title, onMenu }) {
  const { logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 backdrop-blur px-3 sm:px-4 lg:px-6">
      <button
        onClick={onMenu}
        className="lg:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm active:scale-95"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0">
        <p className="text-[10px] sm:text-[11px] font-semibold tracking-[0.14em] text-amber-600 uppercase">RUY GESTÃO</p>
        <h1 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900 truncate">{title}</h1>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" className="relative rounded-xl" aria-label="Alertas">
          <Bell className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => logout()} className="gap-2 rounded-xl text-slate-500 hover:text-rose-600">
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sair</span>
        </Button>
      </div>
    </header>
  );
}
