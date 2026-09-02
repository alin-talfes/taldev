// js/services/storage-service.js
// Serviciu pentru operațiuni de stocare în Supabase Storage
// UX îmbunătățit: validare clară, mesaje de eroare prietenoase

import { getSupabase } from '../supabase.js';

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_EXTENSIONS = [
  'pdf', 'xml', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'csv'
];

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/xml',
  'text/xml',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
];

/**
 * Validează un fișier înainte de încărcare
 * @param {File} file
 * @param {object} options { maxSize, allowedExtensions, allowedMimeTypes }
 * @returns {object} { valid: boolean, error?: string }
 */
export function validateFile(file, options = {}) {
  const maxSize = options.maxSize || DEFAULT_MAX_SIZE;
  const allowedExtensions = options.allowedExtensions || ALLOWED_EXTENSIONS;
  const allowedMimeTypes = options.allowedMimeTypes || ALLOWED_MIME_TYPES;

  if (file.size > maxSize) {
    return {
      valid: false,
      error: `Fișierul este prea mare (max ${Math.round(maxSize / 1024 / 1024)} MB)`
    };
  }

  const extension = file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    return {
      valid: false,
      error: `Format de fișier nepermis (.${extension}). Formate permise: ${allowedExtensions.join(', ')}`
    };
  }

  if (file.type && allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.type)) {
    console.warn(`MIME type neașteptat: ${file.type}`);
  }

  return { valid: true };
}

/**
 * Calculează hash-ul SHA-256 al unui fișier
 * @param {File} file
 * @returns {Promise<string>} hash hexazecimal
 */
export async function calculateSha256(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.warn('Nu am putut calcula SHA-256:', error);
    return null;
  }
}

/**
 * Generează un nume de fișier sigur pentru stocare
 * @param {string} originalName
 * @param {string} prefix - prefix opțional
 * @returns {string} nume unic
 */
export function generateSafeFilename(originalName, prefix = '') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop().toLowerCase();
  const base = prefix ? `${prefix}-` : '';
  return `${base}${timestamp}-${random}.${extension}`;
}

/**
 * Construiește calea de stocare pentru un utilizator
 * @param {string} userId
 * @param {string} category - ex: 'invoices', 'received-invoices', 'expenses', 'contracts', 'assets', 'other'
 * @param {string} filename
 * @returns {string} calea completă în bucket
 */
export function buildStoragePath(userId, category, filename) {
  const safeCategory = category.replace(/[^a-zA-Z0-9-_]/g, '');
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  return `${userId}/${safeCategory}/${safeFilename}`;
}

/**
 * Încarcă un fișier direct în Storage (fără a crea înregistrare în DB)
 * @param {File} file
 * @param {object} options { userId, category, prefix }
 * @returns {Promise<object>} { storagePath, filename }
 */
export async function uploadFileToStorage(file, options = {}) {
  const supabase = await getSupabase();
  const userId = options.userId;
  if (!userId) {
    throw new Error('Lipsește ID-ul utilizatorului');
  }

  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const category = options.category || 'other';
  const safeFilename = generateSafeFilename(file.name, options.prefix);
  const storagePath = buildStoragePath(userId, category, safeFilename);

  const { error } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) {
    if (error.message && error.message.includes('Bucket not found')) {
      throw new Error('Bucket-ul "documents" nu există în Supabase Storage. Creează-l manual.');
    }
    throw new Error(`Upload eșuat: ${error.message}`);
  }

  return {
    storagePath,
    originalFilename: file.name,
    safeFilename
  };
}

/**
 * Obține un URL semnat pentru descărcarea unui fișier
 * @param {string} storagePath
 * @param {number} expiresInSec - durata de valabilitate (secunde)
 * @returns {Promise<string>} signed URL
 */
export async function getSignedUrl(storagePath, expiresInSec = 300) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, expiresInSec);

  if (error) {
    throw new Error(`Nu am putut obține URL-ul: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Șterge un fișier din Storage
 * @param {string} storagePath
 * @returns {Promise<boolean>}
 */
export async function deleteFileFromStorage(storagePath) {
  const supabase = await getSupabase();
  const { error } = await supabase.storage
    .from('documents')
    .remove([storagePath]);

  if (error) {
    throw new Error(`Ștergere eșuată: ${error.message}`);
  }

  return true;
}

/**
 * Listează fișierele dintr-un folder al utilizatorului
 * @param {string} userId
 * @param {string} category - opțional, dacă se dorește doar o categorie
 * @returns {Promise<Array>} lista fișierelor
 */
export async function listFilesInFolder(userId, category = null) {
  const supabase = await getSupabase();
  let path = userId;
  if (category) {
    path += `/${category}`;
  }

  const { data, error } = await supabase.storage
    .from('documents')
    .list(path, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' }
    });

  if (error) {
    throw new Error(`Listare eșuată: ${error.message}`);
  }

  return data || [];
}

/**
 * Verifică dacă un fișier pare duplicat (pe baza hash-ului)
 * @param {string} sha256
 * @param {string} userId
 * @returns {Promise<boolean>} true dacă există deja
 */
export async function isDuplicateByHash(sha256, userId) {
  if (!sha256) return false;

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('documents')
    .select('id')
    .eq('sha256', sha256)
    .eq('owner_user_id', userId)
    .limit(1);

  if (error) {
    console.warn('Verificare duplicat eșuată:', error);
    return false;
  }

  return data && data.length > 0;
}