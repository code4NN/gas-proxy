// cache.js
const sheetCache = {};

/**
 * Set cache for a workbook+sheet combo
 */
export function setCache(key, data) {
    sheetCache[key] = {
        data,
        lastUpdated: Date.now()
    };
}

/**
 * Get cache if not too old
 */
export function getCache(key, maxAgeMs = 60_000) {
    const entry = sheetCache[key];
    if (!entry) return null;
    if (Date.now() - entry.lastUpdated > maxAgeMs) return null;
    return entry.data;
}

/**
 * Clear specific cache
 */
export function clearCache(key) {
    delete sheetCache[key];
}

/**
 * Clear all cache
 */
export function clearAllCache() {
    for (const key in sheetCache) delete sheetCache[key];
}
