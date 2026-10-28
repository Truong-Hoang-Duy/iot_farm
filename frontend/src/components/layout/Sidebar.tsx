import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Leaf, 
  AlertTriangle, 
  Settings, 
  Power, 
  BookOpen,
  Menu,
  X,
  Droplets,
  LogOut,
  User
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Thông tin cây', href: '/plant', icon: Leaf },
  { name: 'Cảnh báo', href: '/alerts', icon: AlertTriangle },
  { name: 'Điều khiển', href: '/controls', icon: Power },
  { name: 'Khuyến nghị', href: '/recommendations', icon: BookOpen },
  { name: 'Cài đặt', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 p-2 rounded-xl bg-card shadow-lg border border-border lg:hidden"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen w-72 transform transition-transform duration-300 ease-in-out lg:translate-x-0",
          "bg-card border-r border-border",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm border border-border/40">
                <img src="/uit_logo.svg" alt="Logo Trường Đại học Công nghệ Thông tin - ĐHQG TP.HCM" className="w-full h-full object-contain" />
            </div>

            <div>
              <h1 className="font-display text-xl font-bold">IoT Farm</h1>
              <p className="text-xs text-muted-foreground font-medium">ĐH CNTT - ĐHQG TP.HCM</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-4 py-4">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-glow"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive && "animate-scale-in")} />
                  {item.name}
                </NavLink>
              );
            })}
          </nav>

          {/* User Info & Logout */}
          <div className="border-t border-border p-4 space-y-3">
            {user && (
              <div className="flex items-center gap-3 rounded-xl bg-secondary/50 p-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>
            )}
            
            <Button
              variant="outline"
              className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Đăng xuất
            </Button>

            <div className="rounded-xl bg-secondary/50 p-3">
              <p className="text-xs text-muted-foreground">
                Kết nối: <span className="text-success font-medium">Trực tuyến</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Cập nhật: {new Date().toLocaleTimeString('vi-VN')}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
