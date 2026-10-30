import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AuthProvider } from "@/contexts/AuthContext";
import Dashboard from "./pages/Dashboard";
import PlantInfo from "./pages/PlantInfo";
import Alerts from "./pages/Alerts";
import Controls from "./pages/Controls";
import Settings from "./pages/Settings";
import Weather from "./pages/Weather";
import Logs from "./pages/Logs";
import ModelLab from "./pages/ModelLab";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout><Dashboard /></Layout>} />
      <Route path="/plant" element={<Layout><PlantInfo /></Layout>} />
      <Route path="/alerts" element={<Layout><Alerts /></Layout>} />
      <Route path="/controls" element={<Navigate to="/settings?tab=controls" replace />} />
      <Route path="/recommendations" element={<Navigate to="/alerts" replace />} />
      <Route path="/weather" element={<Layout><Weather /></Layout>} />
      <Route path="/model-lab" element={<Layout><ModelLab /></Layout>} />
      <Route path="/logs" element={<Layout><Logs /></Layout>} />
      <Route path="/settings" element={<Layout><Settings /></Layout>} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/change-password" element={<Navigate to="/settings" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
