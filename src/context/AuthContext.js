// src/context/AuthContext.js
// Central authentication state for the whole app.
// Tracks the Supabase session + auth user, and loads the matching "profiles" row
// (which holds the user's role). Exposes sign in / sign up / sign out / reset password.

import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

// The context object — consumed via the useAuth() hook.
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // raw Supabase session
  const [user, setUser] = useState(null); // auth user (from auth.users)
  const [profile, setProfile] = useState(null); // matching public.profiles row
  const [loading, setLoading] = useState(true); // true until first session check completes

  // Guard so we don't try to update state after the provider unmounts.
  const mounted = useRef(true);

  // Fetch the profile for the given auth user. If it doesn't exist yet
  // (first ever login), create it with the default 'user' role.
  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) {
      if (mounted.current) setProfile(null);
      return;
    }

    // Try to read the existing profile row.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[GGO] Failed to load profile:', error.message);
    }

    if (data) {
      if (mounted.current) setProfile(data);
      return;
    }

    // No profile yet -> create one (first-login bootstrap).
    const newProfile = {
      id: authUser.id,
      email: authUser.email,
      first_name: authUser.user_metadata?.first_name || '',
      last_name: authUser.user_metadata?.last_name || '',
      role: 'user', // default role; an owner/admin can elevate later
      is_active: true,
    };

    const { data: created, error: createError } = await supabase
      .from('profiles')
      .insert(newProfile)
      .select()
      .single();

    if (createError) {
      // eslint-disable-next-line no-console
      console.error('[GGO] Failed to create profile:', createError.message);
      if (mounted.current) setProfile(null);
      return;
    }

    if (mounted.current) setProfile(created);
  }, []);

  useEffect(() => {
    mounted.current = true;

    // 1) Restore any existing session on first load.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted.current) return;
      setSession(session);
      setUser(session?.user ?? null);
      loadProfile(session?.user ?? null).finally(() => {
        if (mounted.current) setLoading(false);
      });
    });

    // 2) React to future auth changes (login, logout, token refresh).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted.current) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      // Defer the async profile fetch to avoid a known deadlock when calling
      // Supabase from inside the onAuthStateChange callback.
      setTimeout(() => {
        if (mounted.current) loadProfile(newSession?.user ?? null);
      }, 0);
    });

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // --- Auth actions exposed to the rest of the app ---------------------------

  const signIn = useCallback(
    (email, password) => supabase.auth.signInWithPassword({ email, password }),
    []
  );

  // Sign up is included so the very first account can be created and the
  // first-login profile bootstrap can run. metadata holds first/last name.
  const signUp = useCallback(
    (email, password, metadata = {}) =>
      supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
          // Where the email-confirmation link sends the user back to. Uses the
          // current origin so it works in production and local dev.
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      }),
    []
  );

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  // Forgot password — sends a reset email back to the app origin.
  const resetPassword = useCallback(
    (email) =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login',
      }),
    []
  );

  const refreshProfile = useCallback(() => loadProfile(user), [loadProfile, user]);

  const value = {
    session,
    user,
    profile,
    role: profile?.role ?? null,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthContext;
