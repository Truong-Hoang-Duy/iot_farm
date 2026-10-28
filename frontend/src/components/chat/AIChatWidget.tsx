import { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Send, 
  X, 
  Sparkles, 
  RotateCcw, 
  User, 
  Minimize2,
  Sprout,
  HelpCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { sendAIChatMessage, ChatMessageItem } from '@/services/aiAPI';
import { getLatestSensorReading, FirebaseSensorReading } from '@/services/firebaseAPI';

const INITIAL_MESSAGES: ChatMessageItem[] = [
  {
    role: 'model',
    content: 'Xin chào! Tôi là Trợ lý ảo IoT Farm. Tôi có thể hỗ trợ bạn theo dõi tình trạng đất, chế độ tưới, bón phân và kỹ thuật chăm sóc cây ớt trên hệ thống IoT Farm.'
  }
];

const SUGGESTED_PROMPTS = [
  'Độ pH đất 5.4 thì xử lý thế nào?',
  'Hôm nay nên tưới bao nhiêu nước?',
  'Cách phòng trừ bệnh thán thư vào mùa mưa?',
  'Liều lượng bón NPK cho cây ớt 45 ngày?'
];

export function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSensor, setCurrentSensor] = useState<FirebaseSensorReading | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lắng nghe sự kiện mở chat từ các trang khác (ví dụ từ Recommendations page)
  useEffect(() => {
    const handleOpenChat = (event: CustomEvent<{ prompt?: string }>) => {
      setIsOpen(true);
      if (event.detail?.prompt) {
        handleSend(event.detail.prompt);
      }
    };

    window.addEventListener('open-ai-chat' as any, handleOpenChat as any);
    return () => {
      window.removeEventListener('open-ai-chat' as any, handleOpenChat as any);
    };
  }, [messages]);

  // Lấy dữ liệu cảm biến mới nhất làm ngữ cảnh
  useEffect(() => {
    const fetchSensor = async () => {
      try {
        const latest = await getLatestSensorReading();
        if (latest) {
          setCurrentSensor(latest.reading);
        }
      } catch (err) {
        // Silent fail
      }
    };
    fetchSensor();
  }, [isOpen]);

  // Cuộn xuống tin nhắn mới nhất
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Focus input khi mở widget
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  const handleSend = async (customText?: string) => {
    const text = (customText || input).trim();
    if (!text || isLoading) return;

    const newHistory: ChatMessageItem[] = [
      ...messages,
      { role: 'user', content: text }
    ];
    setMessages(newHistory);
    setInput('');
    setIsLoading(true);

    try {
      const reply = await sendAIChatMessage(
        text,
        currentSensor ? {
          moisture: currentSensor.moisture,
          soiltemp: currentSensor.soiltemp,
          pH: currentSensor.pH,
          EC: currentSensor.EC,
          N: currentSensor.N,
          P: currentSensor.P,
          K: currentSensor.K,
        } : undefined,
        newHistory
      );

      setMessages(prev => [...prev, { role: 'model', content: reply }]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'model', content: 'Hiện tại trợ lý AI chưa thể phản hồi. Vui lòng kiểm tra lại kết nối backend.' }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetChat = () => {
    setMessages(INITIAL_MESSAGES);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Cửa sổ Chatbot khi mở */}
      {isOpen && (
        <div className="mb-3 w-[calc(100vw-2rem)] sm:w-[380px] h-[520px] max-h-[82vh] rounded-2xl border border-border/80 bg-card/95 backdrop-blur-md shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="px-4 py-3 bg-primary/10 border-b border-border/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 border border-primary/30">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                  Trợ lý IoT Farm
                </h4>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Hỗ trợ kỹ thuật canh tác • Trực tuyến</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={handleResetChat}
                title="Xóa đoạn chat làm mới"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setIsOpen(false)}
                title="Thu nhỏ"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Dải thông số đất tóm tắt nếu có */}
          {currentSensor && (
            <div className="px-3 py-1.5 bg-muted/40 border-b border-border text-[11px] text-muted-foreground flex items-center justify-between gap-1 overflow-x-auto whitespace-nowrap">
              <span className="flex items-center gap-1 text-primary font-medium">
                <Sprout className="h-3 w-3" /> Trạm IoT Farm:
              </span>
              <span>Ẩm: <strong className="text-foreground">{currentSensor.moisture}%</strong></span>
              <span>pH: <strong className="text-foreground">{currentSensor.pH}</strong></span>
              <span>EC: <strong className="text-foreground">{currentSensor.EC}</strong></span>
              <span>NPK: <strong className="text-foreground">{currentSensor.N}-{currentSensor.P}-{currentSensor.K}</strong></span>
            </div>
          )}

          {/* Khung tin nhắn */}
          <div className="flex-1 p-3.5 space-y-3 overflow-y-auto">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-2 text-xs leading-relaxed",
                  msg.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === 'model' && (
                  <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                )}
                <div
                  className={cn(
                    "px-3 py-2 rounded-2xl max-w-[85%] whitespace-pre-line shadow-xs",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground rounded-br-xs"
                      : "bg-muted/70 text-foreground border border-border/60 rounded-bl-xs"
                  )}
                >
                  {msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="h-6 w-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 p-2 rounded-xl w-fit">
                <Bot className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Trợ lý IoT Farm đang xử lý câu hỏi...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Gợi ý câu hỏi nhanh (chỉ hiện khi chưa có nhiều tin nhắn) */}
          {messages.length <= 3 && !isLoading && (
            <div className="px-3 pb-2 pt-1 border-t border-border/40 bg-card/60">
              <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                <HelpCircle className="h-3 w-3" /> Gợi ý câu hỏi:
              </p>
              <div className="flex flex-wrap gap-1">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(prompt)}
                    className="text-[11px] bg-secondary/80 hover:bg-secondary text-foreground px-2 py-1 rounded-lg border border-border/60 transition-colors text-left truncate max-w-full"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Chat */}
          <div className="p-2.5 border-t border-border/80 bg-background/50">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-1.5"
            >
              <Input
                ref={inputRef}
                placeholder="Hỏi Trợ lý IoT Farm về đất, phân bón, tưới nước..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
                className="h-9 text-xs flex-1 bg-background"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim() || isLoading}
                className="h-9 px-3 shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
            <p className="text-[10px] text-center text-muted-foreground mt-1.5">
              Hệ thống phân tích thông minh IoT Farm - ĐH CNTT (UIT)
            </p>
          </div>
        </div>
      )}

      {/* Nút Floating Icon góc phải */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "h-13 w-13 rounded-full shadow-xl transition-all duration-300 flex items-center justify-center relative",
          isOpen 
            ? "bg-secondary hover:bg-secondary/80 text-foreground" 
            : "bg-primary hover:bg-primary/90 text-primary-foreground hover:scale-105 shadow-primary/25"
        )}
        title={isOpen ? "Đóng trợ lý IoT Farm" : "Mở Trợ lý IoT Farm"}
      >
        {isOpen ? (
          <Minimize2 className="h-5 w-5" />
        ) : (
          <>
            <Bot className="h-6 w-6" />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-background"></span>
            </span>
          </>
        )}
      </Button>
    </div>
  );
}

// Helper để trang khác có thể gọi mở chat
export function triggerOpenAIChat(prompt?: string) {
  window.dispatchEvent(new CustomEvent('open-ai-chat', { detail: { prompt } }));
}
