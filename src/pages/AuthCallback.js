// src/pages/AuthCallback.js
// Landing page for email-confirmation / recovery links. Supabase parses the
// session from the URL (detectSessionInUrl), we listen for the resulting auth
// event and route the user onward.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate('/', { replace: true }); // dashboard lives at "/"
      } else if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', { replace: true });
      } else if (event === 'SIGNED_OUT') {
        navigate('/login', { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0A0F1E',
        color: 'white',
        fontSize: '16px',
      }}
    >
      Verifying your account…
    </div>
  );
}
