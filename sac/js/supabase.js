// js/supabase.js
// Modul de inițializare Supabase
// Folosește Supabase UMD global, cu fallback la încărcare dinamică

import { APP_CONFIG } from './config.js';

let supabase = null;

function ensureSupabaseLoaded() {
  return typeof window.supabase !== 'undefined' && window.supabase.createClient;
}

async function loadSupabaseFromCDN() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/dist/umd/supabase.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Nu s-a putut încărca Supabase SDK'));
    document.head.appendChild(script);
  });
}

export async function getSupabase() {
  if (supabase) return supabase;

  if (!ensureSupabaseLoaded()) {
    await loadSupabaseFromCDN();
    if (!ensureSupabaseLoaded()) {
      throw new Error('Supabase SDK nu este disponibil');
    }
  }

  supabase = window.supabase.createClient(
    APP_CONFIG.supabaseUrl,
    APP_CONFIG.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'pfa-admin-auth'
      },
      global: {
        headers: {
          'X-Client-Info': 'pfa-admin'
        }
      }
    }
  );

  return supabase;
}

export function getSupabaseSync() {
  return supabase;
}