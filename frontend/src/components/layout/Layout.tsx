import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { AIChatWidget } from '@/components/chat/AIChatWidget';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background relative">
      <Sidebar />
      <main className="lg:pl-72">
        <div className="min-h-screen p-4 lg:p-8">
          {children}
        </div>
      </main>
      {/* Chatbot AI tích hợp dạng nhỏ góc phải */}
      <AIChatWidget />
    </div>
  );
}

