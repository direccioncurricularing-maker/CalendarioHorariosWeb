/* eslint-disable react-refresh/only-export-components */
import { createContext, useState } from 'react';
import { authService } from '../services/api';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading] = useState(false);

  const register = async (nombre, mail, password, adminPassword) => {
    const userData = await authService.register(nombre, mail, password, adminPassword);
    setUser(userData.user);
    localStorage.setItem('user', JSON.stringify(userData.user));
    return userData.user;
  };

  const login = async (mail, password) => {
    const userData = await authService.login(mail, password);
    setUser(userData.user);
    localStorage.setItem('user', JSON.stringify(userData.user));
    return userData.user;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  return (
    <AuthContext.Provider value={{ user, loading, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}


