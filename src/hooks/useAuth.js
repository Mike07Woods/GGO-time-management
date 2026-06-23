// src/hooks/useAuth.js
// Convenience hook to read authentication state anywhere in the app.

import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

export function useAuth() {
  const context = useContext(AuthContext);

  // Helps catch the mistake of using this hook outside <AuthProvider>.
  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }

  return context;
}

export default useAuth;
