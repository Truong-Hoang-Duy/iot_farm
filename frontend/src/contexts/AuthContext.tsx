import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth, signInWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from '../config/firebaseConfig'; // Firebase imports

interface AuthContextType {
  user: any;  // Thay thế User với kiểu thích hợp
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResponse>;
}

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  message?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>({
    id: 'admin',
    email: 'admin@smartfarm.com',
    name: 'Quản trị viên',
  });
  const [isLoading, setIsLoading] = useState(false);

  const login = async (email: string, password: string): Promise<AuthResponse> => {
    try {
      console.log('Đang cố gắng đăng nhập với:', email);
      // Đăng nhập với Firebase
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Nếu đăng nhập thành công, lưu thông tin người dùng vào localStorage
      const mockUser = {
        id: user.uid,
        email: user.email || '',
        name: user.displayName || 'User',
      };
      const mockToken = await user.getIdToken(); // Firebase ID Token

      // Lưu thông tin người dùng và token vào localStorage
      localStorage.setItem('auth_token', mockToken);
      localStorage.setItem('user', JSON.stringify(mockUser));

      setUser(mockUser); // Cập nhật trạng thái người dùng
      return {
        success: true,
        user: mockUser,
        token: mockToken,
      };
    } catch (error) {
      console.error('Đăng nhập thất bại:', error.message);
      return {
        success: false,
        message: error.message || 'Email hoặc mật khẩu không chính xác',
      };
    }
  };

  const logout = async () => {
    await auth.signOut(); // Đăng xuất từ Firebase
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    setUser(null); // Cập nhật lại trạng thái người dùng
  };

  // Thêm hàm changePassword xử lý với Firebase
  const changePassword = async (currentPassword: string, newPassword: string): Promise<AuthResponse> => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return {
        success: false,
        message: 'Người dùng chưa đăng nhập.',
      };
    }

    const credential = EmailAuthProvider.credential(currentUser.email || '', currentPassword);

    try {
      // Xác thực lại người dùng với mật khẩu cũ
      await reauthenticateWithCredential(currentUser, credential);

      // Cập nhật mật khẩu mới
      await updatePassword(currentUser, newPassword);

      return {
        success: true,
        message: 'Mật khẩu đã được thay đổi thành công.',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Không thể thay đổi mật khẩu.',
      };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
