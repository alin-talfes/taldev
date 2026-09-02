// js/api.js
// API functions pentru interacțiunea cu Supabase
// Versiune finală – fără expensesApi, cu fiscalApi, câmpuri de deductibilitate limitată.
// Fix: includem id-ul facturii în alocările tranzacțiilor pentru a permite excluderea veniturilor stornate.

import { getSupabase } from './supabase.js';
import { generateIdempotencyKey, sanitizeSearch } from './utils.js';

async function getClient() {
  return await getSupabase();
}

function handleError(error, fallbackMessage = 'A apărut o eroare') {
  console.error('API Error:', error);
  if (error && error.message) {
    throw new Error(error.message);
  }
  throw new Error(fallbackMessage);
}

async function prepareInsertData(data) {
  const user = await authApi.getUser();
  if (!user) throw new Error('Utilizator neautentificat');
  return { ...data, owner_user_id: user.id };
}

// ======================================================================
// AUTH
// ======================================================================
export const authApi = {
  async signIn(email, password) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Autentificare eșuată. Verifică email-ul și parola.');
    }
  },

  async signOut() {
    try {
      const supabase = await getClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      handleError(error, 'Deconectare eșuată');
    }
  },

  async getSession() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session;
    } catch (error) {
      handleError(error, 'Nu am putut obține sesiunea');
    }
  },

  async getUser() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    } catch (error) {
      handleError(error, 'Nu am putut obține utilizatorul');
    }
  },

  async resetPassword(email) {
    try {
      const supabase = await getClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname + '#/reset-password'
      });
      if (error) throw error;
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut trimite email-ul de resetare');
    }
  },

  async updatePassword(newPassword) {
    try {
      const supabase = await getClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return true;
    } catch (error) {
      handleError(error, 'Actualizare parolă eșuată');
    }
  }
};

// ======================================================================
// PROFILE & PFA SETTINGS
// ======================================================================
export const settingsApi = {
  async getSettings() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('pfa_settings')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca setările PFA');
    }
  },

  async saveSettings(settings) {
    try {
      const supabase = await getClient();
      const user = await authApi.getUser();
      if (!user) throw new Error('Utilizator neautentificat');

      const { data: existing, error: fetchError } = await supabase
        .from('pfa_settings')
        .select('id')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (fetchError) throw fetchError;

      if (existing) {
        const { data, error } = await supabase
          .from('pfa_settings')
          .update(settings)
          .eq('owner_user_id', user.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('pfa_settings')
          .insert({ ...settings, owner_user_id: user.id })
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    } catch (error) {
      handleError(error, 'Nu am putut salva setările PFA');
    }
  },

  async updateSettings(settings) {
    return this.saveSettings(settings);
  },

  async createSettings(settings) {
    return this.saveSettings(settings);
  }
};

// ======================================================================
// BANK ACCOUNTS
// ======================================================================
export const bankAccountsApi = {
  async list() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca conturile bancare');
    }
  },

  async create(account) {
    try {
      const supabase = await getClient();
      const dataWithOwner = await prepareInsertData(account);
      const { data, error } = await supabase
        .from('bank_accounts')
        .insert(dataWithOwner)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut adăuga contul bancar');
    }
  },

  async update(id, updates) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('bank_accounts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut actualiza contul bancar');
    }
  },

  async remove(id) {
    try {
      const supabase = await getClient();
      const { error } = await supabase
        .from('bank_accounts')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge contul bancar');
    }
  }
};

// ======================================================================
// CLIENTS
// ======================================================================
export const clientsApi = {
  async list({ search = '', active = null } = {}) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('clients')
        .select('*')
        .order('legal_name', { ascending: true });

      if (search) {
        const safeSearch = sanitizeSearch(search);
        if (safeSearch) {
          query = query.or(`legal_name.ilike.%${safeSearch}%,cui.ilike.%${safeSearch}%,trade_name.ilike.%${safeSearch}%`);
        }
      }
      if (active !== null) {
        query = query.eq('active', active);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca clienții');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Clientul nu a fost găsit');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca clientul');
    }
  },

  async create(client) {
    try {
      const supabase = await getClient();
      const dataWithOwner = await prepareInsertData(client);
      const { data, error } = await supabase
        .from('clients')
        .insert(dataWithOwner)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut adăuga clientul');
    }
  },

  async update(id, updates) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('clients')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut actualiza clientul');
    }
  },

  async remove(id) {
    try {
      const supabase = await getClient();
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge clientul');
    }
  }
};

// ======================================================================
// SUPPLIERS
// ======================================================================
export const suppliersApi = {
  async list({ search = '', active = null } = {}) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('suppliers')
        .select('*')
        .order('legal_name', { ascending: true });

      if (search) {
        const safeSearch = sanitizeSearch(search);
        if (safeSearch) {
          query = query.or(`legal_name.ilike.%${safeSearch}%,cui.ilike.%${safeSearch}%,trade_name.ilike.%${safeSearch}%`);
        }
      }
      if (active !== null) {
        query = query.eq('active', active);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca furnizorii');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Furnizorul nu a fost găsit');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca furnizorul');
    }
  },

  async create(supplier) {
    try {
      const supabase = await getClient();
      const dataWithOwner = await prepareInsertData(supplier);
      const { data, error } = await supabase
        .from('suppliers')
        .insert(dataWithOwner)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut adăuga furnizorul');
    }
  },

  async update(id, updates) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('suppliers')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut actualiza furnizorul');
    }
  },

  async remove(id) {
    try {
      const supabase = await getClient();
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge furnizorul');
    }
  }
};

// ======================================================================
// INVOICE SERIES
// ======================================================================
export const invoiceSeriesApi = {
  async list() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('invoice_series')
        .select('*')
        .order('year', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca seriile de facturare');
    }
  },

  async create(series) {
    try {
      const supabase = await getClient();
      const dataWithOwner = await prepareInsertData(series);
      const { data, error } = await supabase
        .from('invoice_series')
        .insert(dataWithOwner)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut crea seria de facturare');
    }
  },

  async update(id, updates) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('invoice_series')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut actualiza seria de facturare');
    }
  },

  async getActiveSeriesAndNextNumber(year = null) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('get_active_series_and_next_number', {
        p_year: year
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut obține seria activă');
    }
  }
};

// ======================================================================
// PROFORMA SERIES
// ======================================================================
export const proformaSeriesApi = {
  async list() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('proforma_series')
        .select('*')
        .order('year', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca seriile de proforme');
    }
  },

  async create(series) {
    try {
      const supabase = await getClient();
      const dataWithOwner = await prepareInsertData(series);
      const { data, error } = await supabase
        .from('proforma_series')
        .insert(dataWithOwner)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut crea seria de proforme');
    }
  },

  async update(id, updates) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('proforma_series')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut actualiza seria de proforme');
    }
  },

  async getActiveSeriesAndNextNumber(year = null) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('get_active_proforma_series_and_next_number', {
        p_year: year
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut obține seria activă de proforme');
    }
  }
};

// ======================================================================
// INVOICES (Facturi emise)
// ======================================================================
export const invoicesApi = {
  async list(filters = {}) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('invoices')
        .select(`
          *,
          clients:client_id (legal_name, cui),
          invoice_lines (id, position, description, quantity, unit_price, vat_rate, total_amount)
        `, { count: 'exact' });

      if (filters.paymentStatus === 'UNPAID' || filters.paymentStatus === 'PARTIALLY_PAID') {
        query = query.eq('document_status', 'ISSUED')
                     .not('invoice_type', 'in', '("STORNO","CORRECTION")');
      } else if (filters.status && filters.status !== 'all') {
        query = query.eq('document_status', filters.status);
      }

      if (filters.paymentStatus && filters.paymentStatus !== 'all') {
        query = query.eq('payment_status', filters.paymentStatus);
      }
      if (filters.clientId) {
        query = query.eq('client_id', filters.clientId);
      }
      if (filters.fromDate) {
        query = query.gte('issue_date', filters.fromDate);
      }
      if (filters.toDate) {
        query = query.lte('issue_date', filters.toDate);
      }
      if (filters.search) {
        const search = sanitizeSearch(filters.search);
        if (search) {
          const num = parseInt(search, 10);
          if (!isNaN(num)) {
            query = query.or(`series.ilike.%${search}%,number.eq.${num}`);
          } else {
            query = query.or(`series.ilike.%${search}%`);
          }
        }
      }

      const from = (filters.page - 1) * filters.pageSize;
      const to = from + filters.pageSize - 1;
      query = query.range(from, to).order('issue_date', { ascending: false }).order('number', { ascending: false });

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    } catch (error) {
      handleError(error, 'Nu am putut încărca facturile');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          clients:client_id (*),
          invoice_lines (*)
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Factura nu a fost găsită');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca factura');
    }
  },

  async saveDraft(invoiceData, lines = []) {
    try {
      const supabase = await getClient();
      const linesArray = Array.isArray(lines) ? lines : [];
      const { data, error } = await supabase.rpc('save_invoice_draft', {
        p_invoice_id: invoiceData.id || null,
        p_client_id: invoiceData.client_id,
        p_issue_date: invoiceData.issue_date,
        p_due_date: invoiceData.due_date,
        p_currency: invoiceData.currency,
        p_payment_terms: invoiceData.payment_terms,
        p_notes: invoiceData.notes || null,
        p_lines: linesArray
      });
      if (error) throw error;
      const invoiceId = data?.invoice_id || data?.id || invoiceData.id;
      if (invoiceId && invoiceData.currency !== 'RON') {
        const { error: fxError } = await supabase.rpc('set_issued_invoice_document_fx', {
          p_invoice_id: invoiceId,
          p_exchange_rate: invoiceData.document_exchange_rate,
          p_exchange_rate_date: invoiceData.document_exchange_rate_date,
          p_exchange_rate_source: invoiceData.document_exchange_rate_source || 'BNR'
        });
        if (fxError) throw fxError;
      }
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut salva draft-ul facturii');
    }
  },

  async createDraft(invoiceData, lines = []) {
    return this.saveDraft(invoiceData, lines);
  },

  async updateDraft(id, updates, lines = null) {
    const invoiceData = { id, ...updates };
    const lineData = Array.isArray(lines) ? lines : [];
    return this.saveDraft(invoiceData, lineData);
  },

  async removeDraft(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', id)
        .eq('document_status', 'DRAFT')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Draft-ul nu a putut fi șters.');
      }
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge draft-ul facturii');
    }
  },

  async getStornoLinks() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('invoices')
        .select('id, storno_for_invoice_id')
        .not('storno_for_invoice_id', 'is', null);
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut obține legăturile de storno');
    }
  },

  async issue(invoiceId) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('issue_invoice', {
        p_invoice_id: invoiceId
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Emitere factură eșuată');
    }
  },

  async createStorno(originalInvoiceId, type = 'STORNO') {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('create_storno_invoice', {
        p_original_invoice_id: originalInvoiceId,
        p_storno_type: type
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Creare storno eșuată');
    }
  },

  async getHistory(invoiceId) {
    try {
      const supabase = await getClient();
      const { data: auditLogs, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_type', 'invoice')
        .eq('entity_id', invoiceId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return auditLogs || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca istoricul facturii');
    }
  }
};

// ======================================================================
// PROFORMAS
// ======================================================================
export const proformasApi = {
  async list(filters = {}) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('proformas')
        .select(`
          *,
          clients:client_id (legal_name, cui),
          proforma_lines (id, position, description, quantity, unit_price, vat_rate, total_amount)
        `)
        .order('created_at', { ascending: false });

      if (filters.status && filters.status !== 'all') {
        query = query.eq('document_status', filters.status);
      }
      if (filters.clientId) {
        query = query.eq('client_id', filters.clientId);
      }
      if (filters.search) {
        const search = sanitizeSearch(filters.search);
        if (search) {
          const num = parseInt(search, 10);
          if (!isNaN(num)) {
            query = query.or(`series.ilike.%${search}%,number.eq.${num}`);
          } else {
            query = query.or(`series.ilike.%${search}%`);
          }
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca proformele');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('proformas')
        .select(`
          *,
          clients:client_id (*),
          proforma_lines (*)
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Proforma nu a fost găsită');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca proforma');
    }
  },

  async saveDraft(proformaData, lines = []) {
    try {
      const supabase = await getClient();
      const linesArray = Array.isArray(lines) ? lines : [];
      const { data, error } = await supabase.rpc('save_proforma_draft', {
        p_proforma_id: proformaData.id || null,
        p_client_id: proformaData.client_id,
        p_series: proformaData.series || null,
        p_number: proformaData.number || null,
        p_issue_date: proformaData.issue_date,
        p_due_date: proformaData.due_date || null,
        p_currency: proformaData.currency,
        p_payment_terms: proformaData.payment_terms || 14,
        p_notes: proformaData.notes || null,
        p_lines: linesArray
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut salva draft-ul proformei');
    }
  },

  async createDraft(data, lines = []) {
    return this.saveDraft(data, lines);
  },

  async removeDraft(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('proformas')
        .delete()
        .eq('id', id)
        .eq('document_status', 'DRAFT')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Draft-ul proformei nu a putut fi șters.');
      }
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge draft-ul proformei');
    }
  },

  async issue(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('issue_proforma', {
        p_proforma_id: id
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Emitere proforma eșuată');
    }
  },

  async convertToInvoice(proformaId) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('convert_proforma_to_invoice', {
        p_proforma_id: proformaId
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Conversie proforma eșuată');
    }
  }
};

// ======================================================================
// RECEIVED INVOICES
// ======================================================================
export const receivedInvoicesApi = {
  async list(filters = {}) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('received_invoices')
        .select(`
          *,
          suppliers:supplier_id (legal_name, cui),
          received_invoice_lines (id, position, description, quantity, unit_price, vat_rate, total_amount, treatment)
        `)
        .order('document_date', { ascending: false });

      if (filters.status && filters.status !== 'all') {
        query = query.eq('document_status', filters.status);
      }
      if (filters.paymentStatus && filters.paymentStatus !== 'all') {
        query = query.eq('payment_status', filters.paymentStatus);
      }
      if (filters.supplierId) {
        query = query.eq('supplier_id', filters.supplierId);
      }
      if (filters.search) {
        const search = sanitizeSearch(filters.search);
        if (search) {
          query = query.or(`number.ilike.%${search}%,series.ilike.%${search}%`);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca facturile primite');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('received_invoices')
        .select(`
          *,
          suppliers:supplier_id (*),
          received_invoice_lines (*)
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Factura primită nu a fost găsită');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca factura primită');
    }
  },

  async saveDraft(invoiceData, lines = []) {
    try {
      const supabase = await getClient();
      const linesArray = Array.isArray(lines) ? lines : [];
      const { data, error } = await supabase.rpc('save_received_invoice_draft', {
        p_invoice_id: invoiceData.id || null,
        p_supplier_id: invoiceData.supplier_id,
        p_series: invoiceData.series || '',
        p_number: invoiceData.number,
        p_document_date: invoiceData.document_date,
        p_due_date: invoiceData.due_date || null,
        p_currency: invoiceData.currency,
        p_category: invoiceData.category,
        p_deductible_status: invoiceData.deductible_status,
        p_notes: invoiceData.notes || null,
        p_lines: linesArray,
        p_deductibility_percent: invoiceData.deductibility_percent || null,
        p_deductibility_limit: invoiceData.deductibility_limit || null
      });
      if (error) throw error;
      const invoiceId = data?.invoice_id || data?.id || invoiceData.id;
      if (invoiceId && invoiceData.currency !== 'RON') {
        const { error: fxError } = await supabase.rpc('set_received_invoice_document_fx', {
          p_received_invoice_id: invoiceId,
          p_exchange_rate: invoiceData.document_exchange_rate,
          p_exchange_rate_date: invoiceData.document_exchange_rate_date,
          p_exchange_rate_source: invoiceData.document_exchange_rate_source || 'BNR'
        });
        if (fxError) throw fxError;
      }
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut salva draft-ul facturii primite');
    }
  },

  async create(data, lines = []) {
    return this.saveDraft(data, lines);
  },

  async update(id, updates) {
    const existing = await this.get(id);
    if (!existing) throw new Error('Factura primită nu a fost găsită');
    const mergedData = { ...existing, ...updates, id };
    const lines = await this.getLines(id);
    return this.saveDraft(mergedData, lines);
  },

  async getLines(id) {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('received_invoice_lines')
      .select('*')
      .eq('received_invoice_id', id)
      .order('position');
    if (error) throw error;
    return data || [];
  },

  async removeDraft(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('received_invoices')
        .delete()
        .eq('id', id)
        .eq('document_status', 'DRAFT')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Draft-ul facturii primite nu a putut fi șters.');
      }
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge draft-ul facturii primite');
    }
  },

  async confirm(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('confirm_received_invoice', {
        p_invoice_id: id
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Confirmare factură primită eșuată');
    }
  },

  async createStornoRpc(originalInvoiceId, series, number, date) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('create_received_invoice_storno', {
        p_original_invoice_id: originalInvoiceId,
        p_storno_series: series,
        p_storno_number: number,
        p_storno_date: date
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut crea storno-ul facturii primite');
    }
  }
};

// ======================================================================
// FINANCIAL TRANSACTIONS
// ======================================================================
export const transactionsApi = {
  async list(filters = {}) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('financial_transactions')
        .select(`
          *,
          bank_accounts:bank_account_id (iban, bank_name),
          transaction_allocations (
            id, allocated_amount,
            invoices:invoice_id (id, series, number),
            received_invoices:received_invoice_id (id, series, number)
          )
        `)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (filters.direction && filters.direction !== 'all') {
        query = query.eq('direction', filters.direction);
      }
      if (filters.type && filters.type !== 'all') {
        query = query.eq('transaction_type', filters.type);
      }
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.fromDate) {
        query = query.gte('transaction_date', filters.fromDate);
      }
      if (filters.toDate) {
        query = query.lte('transaction_date', filters.toDate);
      }
      if (filters.search) {
        const search = sanitizeSearch(filters.search);
        if (search) {
          query = query.or(`description.ilike.%${search}%,counterparty_name.ilike.%${search}%`);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca tranzacțiile');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('financial_transactions')
        .select(`
          *,
          transaction_allocations (
            id, allocated_amount,
            invoices:invoice_id (id, series, number),
            received_invoices:received_invoice_id (id, series, number)
          )
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Tranzacția nu a fost găsită');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca tranzacția');
    }
  },

  async registerReceipt({ invoiceId, amount, date, paymentMethod, bankAccountId, notes, exchangeRate = null, exchangeRateDate = null, exchangeRateSource = null, bankAmountRon = null, bankSettlementAmount = null, bankSettlementCurrency = null, bankFeeRon = 0, fxFiscalTreatment = null }) {
    try {
      const supabase = await getClient();
      const idempotencyKey = generateIdempotencyKey();
      const { data, error } = await supabase.rpc('register_receipt', {
        p_invoice_id: invoiceId,
        p_amount: amount,
        p_transaction_date: date,
        p_payment_method: paymentMethod,
        p_bank_account_id: bankAccountId,
        p_notes: notes,
        p_idempotency_key: idempotencyKey,
        p_exchange_rate: exchangeRate, p_exchange_rate_date: exchangeRateDate, p_exchange_rate_source: exchangeRateSource,
        p_bank_amount_ron: bankAmountRon, p_bank_settlement_amount: bankSettlementAmount,
        p_bank_settlement_currency: bankSettlementCurrency, p_bank_fee_ron: bankFeeRon, p_fx_fiscal_treatment: fxFiscalTreatment
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Înregistrare încasare eșuată');
    }
  },

  async registerPayment({ receivedInvoiceId, amount, date, paymentMethod, bankAccountId, notes, exchangeRate = null, exchangeRateDate = null, exchangeRateSource = null, bankAmountRon = null, bankSettlementAmount = null, bankSettlementCurrency = null, bankFeeRon = 0, fxFiscalTreatment = null }) {
    try {
      const supabase = await getClient();
      const idempotencyKey = generateIdempotencyKey();
      const { data, error } = await supabase.rpc('register_payment', {
        p_received_invoice_id: receivedInvoiceId,
        p_amount: amount,
        p_transaction_date: date,
        p_payment_method: paymentMethod,
        p_bank_account_id: bankAccountId,
        p_notes: notes,
        p_idempotency_key: idempotencyKey,
        p_exchange_rate: exchangeRate, p_exchange_rate_date: exchangeRateDate, p_exchange_rate_source: exchangeRateSource,
        p_bank_amount_ron: bankAmountRon, p_bank_settlement_amount: bankSettlementAmount,
        p_bank_settlement_currency: bankSettlementCurrency, p_bank_fee_ron: bankFeeRon, p_fx_fiscal_treatment: fxFiscalTreatment
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Înregistrare plată eșuată');
    }
  },

  async createManual({ direction, type, amount, date, currency, paymentMethod, bankAccountId, description, counterparty, reference }) {
    try {
      const supabase = await getClient();
      const idempotencyKey = generateIdempotencyKey();
      const { data, error } = await supabase.rpc('register_manual_transaction', {
        p_direction: direction,
        p_transaction_type: type,
        p_amount: amount,
        p_transaction_date: date,
        p_currency: currency,
        p_payment_method: paymentMethod,
        p_bank_account_id: bankAccountId,
        p_description: description,
        p_counterparty_name: counterparty,
        p_reference: reference,
        p_idempotency_key: idempotencyKey
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Creare tranzacție manuală eșuată');
    }
  },

  async remove(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('financial_transactions')
        .delete()
        .eq('id', id)
        .eq('status', 'PENDING')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Operațiunea confirmată nu poate fi ștearsă.');
      }
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge tranzacția');
    }
  }
};

// ======================================================================
// OTHER OPERATIONS (Alte încasări / cheltuieli, FĂRĂ aporturi/retrageri)
// ======================================================================
export const otherOperationsApi = {
  async list(filters = {}) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('financial_transactions')
        .select(`
          *,
          bank_accounts:bank_account_id (iban, bank_name)
        `)
        .in('transaction_type', ['OTHER_IN', 'OTHER_OUT', 'ADJUSTMENT'])
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (filters.direction && filters.direction !== 'all') {
        query = query.eq('direction', filters.direction);
      }
      if (filters.category && filters.category !== 'all') {
        query = query.eq('category', filters.category);
      }
      if (filters.paymentMethod && filters.paymentMethod !== 'all') {
        query = query.eq('payment_method', filters.paymentMethod);
      }
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.fromDate) {
        query = query.gte('transaction_date', filters.fromDate);
      }
      if (filters.toDate) {
        query = query.lte('transaction_date', filters.toDate);
      }
      if (filters.search) {
        const search = sanitizeSearch(filters.search);
        if (search) {
          query = query.or(`description.ilike.%${search}%,counterparty_name.ilike.%${search}%,reference.ilike.%${search}%,document_number.ilike.%${search}%`);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca operațiunile');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('financial_transactions')
        .select(`
          *,
          bank_accounts:bank_account_id (iban, bank_name)
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Operațiunea nu a fost găsită');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca operațiunea');
    }
  },

  async save(operation) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('save_other_operation', {
        p_id: operation.id || null,
        p_direction: operation.direction,
        p_transaction_type: operation.transaction_type,
        p_amount: operation.amount,
        p_transaction_date: operation.transaction_date,
        p_currency: operation.currency || 'RON',
        p_payment_method: operation.payment_method || 'BANK',
        p_bank_account_id: operation.bank_account_id || null,
        p_description: operation.description || null,
        p_category: operation.category || null,
        p_fiscal_treatment: operation.fiscal_treatment || null,
        p_document_type: operation.document_type || null,
        p_document_number: operation.document_number || null,
        p_document_date: operation.document_date || null,
        p_notes: operation.notes || null,
        p_counterparty_name: operation.counterparty_name || null,
        p_reference: operation.reference || null,
        p_deductibility_percent: operation.deductibility_percent || null,
        p_deductibility_limit: operation.deductibility_limit || null
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut salva operațiunea');
    }
  },

  async cancel(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('cancel_other_operation', {
        p_transaction_id: id
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut anula operațiunea');
    }
  }
};

// ======================================================================
// FISCAL API (Registrul de evidență fiscală + Declarația unică)
// ======================================================================
export const fiscalApi = {
  async getSummary(year = null) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('get_fiscal_summary', {
        p_year: year
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut obține rezumatul fiscal');
    }
  },

  async getMonthlySummary(year = null) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('fiscal_monthly_summary')
        .select('*')
        .order('month_start', { ascending: true });
      if (year) {
        query = query.eq('year', year);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut obține rezumatul lunar fiscal');
    }
  }
};

// ======================================================================
// DOCUMENTS
// ======================================================================
export const documentsApi = {
  async upload(file, metadata = {}) {
    try {
      const supabase = await getClient();
      const user = await authApi.getUser();
      if (!user) throw new Error('Utilizator neautentificat');

      const userId = user.id;
      const fileExt = file.name.split('.').pop().toLowerCase();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const storagePath = `${userId}/${metadata.category || 'other'}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false
        });
      if (uploadError) throw uploadError;

      let sha256 = null;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        console.warn('Nu am putut calcula SHA-256', e);
      }

      const { data: docRecord, error: dbError } = await supabase
        .from('documents')
        .insert({
          owner_user_id: userId,
          storage_path: storagePath,
          original_filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
          sha256: sha256,
          uploaded_by: userId
        })
        .select()
        .single();
      if (dbError) {
        await supabase.storage.from('documents').remove([storagePath]);
        throw dbError;
      }

      if (metadata.entityType && metadata.entityId) {
        const linkData = {
          document_id: docRecord.id,
          [metadata.entityType]: metadata.entityId
        };
        const { error: linkError } = await supabase
          .from('document_links')
          .insert(linkData);
        if (linkError) {
          await supabase.rpc('archive_unlinked_document', {
            p_document_id: docRecord.id,
            p_reason: 'Încărcare anulată: asocierea documentului a eșuat'
          });
          throw linkError;
        }
      }

      return docRecord;
    } catch (error) {
      handleError(error, 'Nu am putut încărca documentul');
    }
  },

  async getSignedUrl(storagePath) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(storagePath, 60 * 5);
      if (error) throw error;
      return data.signedUrl;
    } catch (error) {
      handleError(error, 'Nu am putut obține URL-ul documentului');
    }
  },

  async listForEntity(entityType, entityId) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('document_links')
        .select(`
          documents (*)
        `)
        .eq(entityType, entityId);
      if (error) throw error;
      return (data || []).map(d => d.documents);
    } catch (error) {
      handleError(error, 'Nu am putut încărca documentele');
    }
  },

  async archive(documentId, reason = null) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('archive_unlinked_document', {
        p_document_id: documentId,
        p_reason: reason
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut arhiva documentul');
    }
  }
};

// ======================================================================
// INVENTORY
// ======================================================================
export const inventoryApi = {
  async list() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .order('record_date', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca inventarul');
    }
  },

  async create(item) {
    try {
      const supabase = await getClient();
      const dataWithOwner = await prepareInsertData(item);
      const { data, error } = await supabase
        .from('inventory_items')
        .insert(dataWithOwner)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut adăuga elementul de inventar');
    }
  },

  async update(id, updates) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('inventory_items')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut actualiza elementul de inventar');
    }
  },

  async remove(id) {
    try {
      const supabase = await getClient();
      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge elementul de inventar');
    }
  }
};

// ======================================================================
// FIXED ASSETS
// ======================================================================
export const fixedAssetsApi = {
  async list() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('fixed_assets')
        .select('*')
        .order('acquisition_date', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca mijloacele fixe');
    }
  },

  async get(id) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('fixed_assets')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Mijloc fix nu a fost găsit');
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut încărca mijlocul fix');
    }
  },

  async create(asset) {
    try {
      const supabase = await getClient();
      const dataWithOwner = await prepareInsertData(asset);
      const { data, error } = await supabase
        .from('fixed_assets')
        .insert(dataWithOwner)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut adăuga mijlocul fix');
    }
  },

  async update(id, updates) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('fixed_assets')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut actualiza mijlocul fix');
    }
  },

  async remove(id) {
    try {
      const supabase = await getClient();
      const { error } = await supabase
        .from('fixed_assets')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      handleError(error, 'Nu am putut șterge mijlocul fix');
    }
  },

  async generateInventoryNumber(assetId) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('generate_inventory_number', {
        p_fixed_asset_id: assetId
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut genera numărul de inventar');
    }
  },

  async createFromInvoiceLine(params) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('create_fixed_asset_from_invoice_line', {
        p_received_invoice_line_id: params.receivedInvoiceLineId,
        p_name: params.name,
        p_asset_category: params.assetCategory || null,
        p_classification_code: params.classificationCode || null,
        p_serial_number: params.serialNumber || null,
        p_entry_date: params.entryDate || null,
        p_commissioning_date: params.commissioningDate || null,
        p_depreciation_method: params.depreciationMethod || 'LINEAR',
        p_useful_life_months: params.usefulLifeMonths || null,
        p_depreciation_start_date: params.depreciationStartDate || null,
        p_location: params.location || null,
        p_responsible_person: params.responsiblePerson || null,
        p_notes: params.notes || null
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut crea mijlocul fix din factură');
    }
  },

  async generateDepreciationSchedule(assetId, version = 1) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('generate_depreciation_schedule', {
        p_fixed_asset_id: assetId,
        p_version: version
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut genera planul de amortizare');
    }
  },

  async recordDepreciationEntry(assetId, period, amount) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('record_depreciation_entry', {
        p_fixed_asset_id: assetId,
        p_period: period,
        p_amount: amount
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut înregistra amortizarea');
    }
  },

  async disposeAsset(assetId, disposalType, disposalDate, notes = null) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase.rpc('dispose_fixed_asset', {
        p_fixed_asset_id: assetId,
        p_disposal_type: disposalType,
        p_disposal_date: disposalDate,
        p_notes: notes
      });
      if (error) throw error;
      return data;
    } catch (error) {
      handleError(error, 'Nu am putut scoate din funcțiune mijlocul fix');
    }
  },

  async getDepreciationEntries(assetId) {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('fixed_asset_depreciation_entries')
        .select('*')
        .eq('fixed_asset_id', assetId)
        .order('period', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca istoricul amortizării');
    }
  }
};

// ======================================================================
// REPORTS / VIEWS
// ======================================================================
export const reportsApi = {
  async getRjip({ fromDate, toDate, direction = 'all' }) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('rjip_view')
        .select('*')
        .gte('transaction_date', fromDate)
        .lte('transaction_date', toDate)
        .order('transaction_date', { ascending: true });

      if (direction !== 'all') {
        query = query.eq('direction', direction);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut genera RJIP');
    }
  },

  async getMonthlyCashflow(year = null) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('monthly_cashflow_summary')
        .select('*')
        .order('month_start', { ascending: false });
      if (year) {
        query = query.eq('year', year);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut genera raportul de cashflow');
    }
  },

  async getOverdueInvoices() {
    try {
      const supabase = await getClient();
      const { data, error } = await supabase
        .from('overdue_invoices_view')
        .select('*');
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca facturile restante');
    }
  }
};

// ======================================================================
// AUDIT LOGS
// ======================================================================
export const auditApi = {
  async list(entityType = null, entityId = null, limit = 50) {
    try {
      const supabase = await getClient();
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (entityType) {
        query = query.eq('entity_type', entityType);
      }
      if (entityId) {
        query = query.eq('entity_id', entityId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      handleError(error, 'Nu am putut încărca auditul');
    }
  }
};

// Exportăm toate API-urile
export default {
  authApi,
  settingsApi,
  bankAccountsApi,
  clientsApi,
  suppliersApi,
  invoiceSeriesApi,
  proformaSeriesApi,
  invoicesApi,
  proformasApi,
  receivedInvoicesApi,
  transactionsApi,
  documentsApi,
  inventoryApi,
  fixedAssetsApi,
  reportsApi,
  auditApi,
  otherOperationsApi,
  fiscalApi
};
