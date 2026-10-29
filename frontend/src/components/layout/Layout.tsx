import { ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { AIChatWidget } from '@/components/chat/AIChatWidget';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background relative">
      <Sidebar
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
      />
      <main
        className={cn(
          "transition-all duration-300 ease-in-out",
          isCollapsed ? "lg:pl-20" : "lg:pl-72"
        )}
      >
        <div className="min-h-screen p-4 lg:p-8">
          {children}
        </div>
      </main>
      {/* Chatbot AI tích hợp dạng nhỏ góc phải */}
      <AIChatWidget />
    </div>
  );
}
