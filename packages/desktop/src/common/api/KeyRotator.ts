/**
 * KeyRotator — manages multi-key rotation for providers.
 *
 * Stores the full key list per provider in localStorage.
 * Only one key is active at a time in the backend database.
 * When a request fails with 401/429, the caller invokes rotate()
 * to swap to the next key and returns the new key for retry.
 */

const STORAGE_PREFIX = 'aionui_keys_';

function storageKey(providerId: string): string {
  return `${STORAGE_PREFIX}${providerId}`;
}

export interface KeyRotationState {
  keys: string[];
  currentIndex: number;
}

/**
 * Parse a raw api_key string into individual keys.
 * Supports comma-separated and newline-separated formats.
 * Whitespace-only entries are discarded.
 */
export function parseKeys(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((k) => k.replace(/[\s\r\t]/g, '').trim())
    .filter((k) => k.length > 0);
}

/**
 * Store the full key list for a provider. Call this when saving provider config.
 */
export function storeKeys(providerId: string, rawApiKey: string): void {
  const keys = parseKeys(rawApiKey);
  if (keys.length === 0) return;
  const state: KeyRotationState = { keys, currentIndex: 0 };
  try {
    localStorage.setItem(storageKey(providerId), JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

/**
 * Get the current active key for a provider.
 * Returns null if no keys are stored (single-key provider or not yet stored).
 */
export function getCurrentKey(providerId: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey(providerId));
    if (!raw) return null;
    const state: KeyRotationState = JSON.parse(raw);
    if (!state.keys || state.keys.length === 0) return null;
    return state.keys[state.currentIndex % state.keys.length];
  } catch {
    return null;
  }
}

/**
 * Rotate to the next key and return it.
 * Returns null if only one key (nothing to rotate).
 */
export function rotateKey(providerId: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey(providerId));
    if (!raw) return null;
    const state: KeyRotationState = JSON.parse(raw);
    if (!state.keys || state.keys.length <= 1) return null;
    state.currentIndex = (state.currentIndex + 1) % state.keys.length;
    localStorage.setItem(storageKey(providerId), JSON.stringify(state));
    return state.keys[state.currentIndex];
  } catch {
    return null;
  }
}

/**
 * Get the number of stored keys for a provider.
 */
export function getKeyCount(providerId: string): number {
  try {
    const raw = localStorage.getItem(storageKey(providerId));
    if (!raw) return 0;
    const state: KeyRotationState = JSON.parse(raw);
    return state.keys?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Get all stored keys for a provider.
 * Returns empty array if no keys stored.
 */
export function getAllKeys(providerId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(providerId));
    if (!raw) return [];
    const state: KeyRotationState = JSON.parse(raw);
    return state.keys ?? [];
  } catch {
    return [];
  }
}

/**
 * Clear stored keys for a provider.
 */
export function clearKeys(providerId: string): void {
  try {
    localStorage.removeItem(storageKey(providerId));
  } catch {
    // ignore
  }
}

/**
 * Check if an error indicates an auth/key problem that should trigger rotation.
 */
export function isAuthError(error: unknown): boolean {
  if (!error) return false;
  const msg = typeof error === 'string' ? error : (error as Error).message || String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('429') ||
    lower.includes('invalid_authorization') ||
    lower.includes('invalid authorization') ||
    lower.includes('unauthorized') ||
    lower.includes('rate limit') ||
    lower.includes('api key')
  );
}

/**
 * Rotate the key for a provider and update the backend database.
 * Returns the new key if rotation succeeded, null if no more keys to try.
 *
 * Usage:
 *   const newKey = await rotateProviderKey(providerId, updateProviderFn);
 *   if (newKey) { /* retry the request *​/ }
 */
export async function rotateProviderKey(
  providerId: string,
  updateProvider: (id: string, fields: { api_key: string }) => Promise<unknown>,
): Promise<string | null> {
  const nextKey = rotateKey(providerId);
  if (!nextKey) return null;
  try {
    await updateProvider(providerId, { api_key: nextKey });
    return nextKey;
  } catch {
    return null;
  }
}
