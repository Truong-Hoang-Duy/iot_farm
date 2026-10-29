import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Leaf, 
  AlertTriangle, 
  Settings, 
  Power, 
  BookOpen,
  CloudSun,
  LineChart,
  ScrollText,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn, formatDateTimeVN } from '@/lib/utils';
import { DeviceOnlineIndicator } from '@/components/layout/DeviceOnlineIndicator';

const navigation = [
  { name: 'Tổng quan', href: '/', icon: LayoutDashboard },
  { name: 'Thông tin cây trồng', href: '/plant', icon: Leaf },
  { name: 'Thời tiết', href: '/weather', icon: CloudSun },
  { name: 'Cảnh báo', href: '/alerts', icon: AlertTriangle },
  { name: 'Điều khiển', href: '/controls', icon: Power },
  { name: 'Dự báo & Model', href: '/model-lab', icon: LineChart },
  { name: 'Khuyến nghị', href: '/recommendations', icon: BookOpen },
  { name: 'Nhật ký thiết bị', href: '/logs', icon: ScrollText },
  { name: 'Cài đặt', href: '/settings', icon: Settings },
];

interface SidebarProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Đóng menu' : 'Mở menu'}
        className="fixed top-4 left-4 z-50 p-2 rounded-xl bg-card shadow-lg border border-border lg:hidden"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen transform transition-all duration-300 ease-in-out lg:translate-x-0",
          "bg-card border-r border-border",
          isCollapsed ? "lg:w-20 w-72" : "w-72",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Nút bấm đóng/mở nhanh trên cạnh phải thanh điều hướng (Desktop) */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            aria-label={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            className="hidden lg:flex absolute -right-3.5 top-9 z-50 h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}

        <div className="flex h-full flex-col">
          {/* Logo & Toggle Header */}
          <div
            className={cn(
              "flex items-center border-b border-border/50 transition-all duration-300",
              isCollapsed ? "lg:justify-center lg:px-2 lg:py-6 px-6 py-6 justify-between" : "justify-between px-6 py-6"
            )}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm border border-border/40">
                <img
                  src="/uit_logo.svg"
                  alt="Logo Trường Đại học Công nghệ Thông tin - ĐHQG TP.HCM"
                  className="w-full h-full object-contain"
                />
              </div>

              <div
                className={cn(
                  "transition-all duration-200 overflow-hidden whitespace-nowrap",
                  isCollapsed && "lg:hidden"
                )}
              >
                <h1 className="font-display text-lg font-bold leading-tight">IoT Farm</h1>
                <p className="text-xs text-muted-foreground font-medium">ĐH CNTT - ĐHQG TP.HCM</p>
              </div>
            </div>

            {onToggleCollapse && !isCollapsed && (
              <button
                onClick={onToggleCollapse}
                title="Thu gọn điều hướng"
                className="hidden lg:flex p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1.5 px-3 py-4">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  onClick={() => setIsOpen(false)}
                  title={isCollapsed ? item.name : undefined}
                  className={cn(
                    "flex items-center rounded-xl py-3 text-sm font-medium transition-all duration-200",
                    isCollapsed ? "lg:justify-center lg:px-2 px-4 gap-3" : "px-4 gap-3",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-glow"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("h-5 w-5 shrink-0", isActive && "animate-scale-in")} />
                  <span
                    className={cn(
                      "truncate transition-all duration-200",
                      isCollapsed && "lg:hidden"
                    )}
                  >
                    {item.name}
                  </span>
                </NavLink>
              );
            })}
          </nav>

          {/* Nút mở rộng ở chân sidebar khi đang ở trạng thái thu gọn */}
          {onToggleCollapse && isCollapsed && (
            <div className="hidden lg:flex justify-center pb-2">
              <button
                onClick={onToggleCollapse}
                title="Mở rộng điều hướng"
                className="p-2.5 rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <PanelLeftOpen className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* System & Device Status */}
          <div className="border-t border-border p-3">
            <div
              className={cn(
                "rounded-xl bg-secondary/50 p-3 transition-all",
                isCollapsed && "lg:flex lg:items-center lg:justify-center lg:p-2.5"
              )}
              title={isCollapsed ? "Trạng thái thiết bị Jetson" : undefined}
            >
              <div className={cn("hidden", isCollapsed && "lg:block")}>
                <span className="block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" />
              </div>
              <div className={cn("space-y-2", isCollapsed && "lg:hidden")}>
                <DeviceOnlineIndicator />
                <div className="pt-1.5 border-t border-border/40 text-[11px] text-muted-foreground">
                  Hệ thống: {formatDateTimeVN(new Date())}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
