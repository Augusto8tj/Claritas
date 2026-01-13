// src/services/utils/sanitize-for-firestore.ts
/**
 * Recursively sanitizes an object to be Firestore-compatible.
 * - Removes keys with `undefined` values.
 * - Converts `NaN` values to `null`.
 * This is crucial because Firestore does not support these values.
 * @param obj The object to sanitize.
 * @returns A new, sanitized object.
 */
export function sanitizeForFirestore(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'number' && isNaN(obj)) {
      return null;
    }
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item));
  }

  const newObj: { [key: string]: any } = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== undefined) {
        newObj[key] = sanitizeForFirestore(value);
      }
    }
  }

  return newObj;
}
