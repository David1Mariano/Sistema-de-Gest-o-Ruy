import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { currentNavItem } from '@/lib/navigation';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const current = currentNavItem(location.pathname);
  const title = current?.label || 'RUY GESTÃO';

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenu={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-x-hidden">
          <div className="w-full max-w-[1600px] mx-auto p-3 sm:p-4 lg:p-6 xl:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
