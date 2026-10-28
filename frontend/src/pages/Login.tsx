import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Leaf, Droplets, Sun, Wind } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng nhập đầy đủ email và mật khẩu',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await login(email, password);
      
      if (response.success) {
        toast({
          title: 'Đăng nhập thành công',
          description: 'Chào mừng bạn trở lại!',
        });
        navigate('/');
      } else {
        toast({
          title: 'Đăng nhập thất bại',
          description: response.message || 'Email hoặc mật khẩu không chính xác',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Lỗi',
        description: 'Không thể kết nối đến server',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Decorative Panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-emerald-900 via-green-800 to-teal-900">
        {/* Animated Background Elements - positioned to avoid text */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -left-20 w-72 h-72 bg-emerald-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-teal-400/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        {/* Floating Icons - positioned at edges to not overlap text */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[8%] right-[8%] animate-float">
            <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
              <Leaf className="h-6 w-6 text-emerald-300" />
            </div>
          </div>
          <div className="absolute top-[25%] right-[5%] animate-float" style={{ animationDelay: '0.5s' }}>
            <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
              <Droplets className="h-6 w-6 text-cyan-300" />
            </div>
          </div>
          <div className="absolute bottom-[25%] right-[8%] animate-float" style={{ animationDelay: '1s' }}>
            <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
              <Sun className="h-6 w-6 text-yellow-300" />
            </div>
          </div>
          <div className="absolute bottom-[8%] right-[5%] animate-float" style={{ animationDelay: '1.5s' }}>
            <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
              <Wind className="h-6 w-6 text-teal-300" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm font-medium">Smart Irrigation System</span>
              </div>
              <h1 className="text-5xl font-bold leading-tight">
                <span className="text-white">Quản lý</span>
                <br />
                <span className="bg-gradient-to-r from-emerald-300 via-green-300 to-teal-300 bg-clip-text text-transparent">
                  Tưới tiêu thông minh
                </span>
              </h1>
              <p className="text-lg text-white/70 max-w-md leading-relaxed">
                Giám sát và điều khiển hệ thống tưới tiêu nông nghiệp với công nghệ IoT tiên tiến, 
                tối ưu hóa năng suất cây trồng.
              </p>
            </div>

            {/* Feature Pills */}
            <div className="flex flex-wrap gap-3">
              {['Realtime Monitoring', 'Auto Irrigation', 'Smart Alerts', 'Data Analytics'].map((feature, index) => (
                <div 
                  key={feature}
                  className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-white/80"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {feature}
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8 pt-8 border-t border-white/10">
              <div>
                <div className="text-3xl font-bold text-emerald-300">24/7</div>
                <div className="text-sm text-white/60 mt-1">Monitoring</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-300">99%</div>
                <div className="text-sm text-white/60 mt-1">Uptime</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-teal-300">IoT</div>
                <div className="text-sm text-white/60 mt-1">Connected</div>
              </div>
            </div>
          </div>
        </div>

        {/* Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gradient-to-b from-background to-secondary/20">
        <div className="w-full max-w-md space-y-8">
          {/* Logo & Title */}
          <div className="text-center space-y-6">
            <div className="inline-flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl blur-xl opacity-30 scale-110" />
                <div className="relative bg-white dark:bg-card p-4 rounded-2xl border border-border/60 shadow-xl flex items-center justify-center">
                  <img 
                    src="/uit_logo.svg" 
                    alt="Logo Trường Đại học Công nghệ Thông tin - ĐHQG TP.HCM" 
                    className="h-20 w-auto object-contain"
                  />
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <h1 className="text-4xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-emerald-600 via-green-600 to-teal-600 dark:from-emerald-400 dark:via-green-400 dark:to-teal-400 bg-clip-text text-transparent">
                  IoT Farm
                </span>
              </h1>
              <p className="text-muted-foreground">
                Đăng nhập để tiếp tục
              </p>
            </div>
          </div>

          {/* Login Form Card */}
          <div className="rounded-3xl border border-border/50 bg-card/80 backdrop-blur-sm p-8 shadow-2xl shadow-emerald-900/5">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="h-12 px-4 bg-background/50 border-border/50 rounded-xl focus:border-emerald-500 focus:ring-emerald-500/20 transition-all"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Mật khẩu
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="h-12 px-4 pr-12 bg-background/50 border-border/50 rounded-xl focus:border-emerald-500 focus:ring-emerald-500/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold rounded-xl bg-gradient-to-r from-emerald-600 via-green-600 to-teal-600 hover:from-emerald-700 hover:via-green-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 transition-all duration-300"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Đang đăng nhập...
                  </>
                ) : (
                  'Đăng nhập'
                )}
              </Button>
            </form>
          </div>

          {/* Footer */}
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-border" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Smart Agriculture System</span>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-border" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-600 dark:from-blue-400 dark:via-indigo-400 dark:to-teal-400 bg-clip-text text-transparent">
                Trường Đại học Công nghệ Thông tin — ĐHQG TP.HCM
              </p>
              <p className="text-xs text-muted-foreground">
                © 2025 IoT Farm - Smart Agriculture System
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}