import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Home from '@/pages/Home';
import Funcionarios from '@/pages/Funcionarios';
import Ponto from '@/pages/Ponto';
import Escalas from '@/pages/Escalas';
import Relatorios from '@/pages/Relatorios';
import Configuracoes from '@/pages/Configuracoes';
import RH from '@/pages/RH';
import FichaColaborador from '@/pages/FichaColaborador';
import Setores from '@/pages/Setores';
import Funcoes from '@/pages/Funcoes';
import OcorrenciasFrequencia from '@/pages/OcorrenciasFrequencia';
import Vales from '@/pages/Vales';
import Consumo from '@/pages/Consumo';
import Advertencias from '@/pages/Advertencias';
import Financeiro from '@/pages/Financeiro';
import Compras from '@/pages/Compras';
import Estoque from '@/pages/Estoque';
import ReceitasFinanceiras from '@/pages/ReceitasFinanceiras';
import Producao from '@/pages/Producao';
import RelatorioFinanceiro from '@/pages/RelatorioFinanceiro';
import Direcao from '@/pages/Direcao';
import Auditoria from '@/pages/Auditoria';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/direcao" element={<Direcao />} />
          <Route path="/rh" element={<RH />} />
          <Route path="/funcionarios" element={<Funcionarios />} />
          <Route path="/funcionarios/:id" element={<FichaColaborador />} />
          <Route path="/setores" element={<Setores />} />
          <Route path="/funcoes" element={<Funcoes />} />
          <Route path="/ocorrencias" element={<OcorrenciasFrequencia />} />
          <Route path="/vales" element={<Vales />} />
          <Route path="/consumo" element={<Consumo />} />
          <Route path="/advertencias" element={<Advertencias />} />
          <Route path="/financeiro" element={<Financeiro />} />
          <Route path="/receitas" element={<ReceitasFinanceiras />} />
          <Route path="/compras" element={<Compras />} />
          <Route path="/estoque" element={<Estoque />} />
          <Route path="/producao" element={<Producao />} />
          <Route path="/ponto" element={<Ponto />} />
          <Route path="/escalas" element={<Escalas />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/relatorios/financeiro" element={<RelatorioFinanceiro />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App