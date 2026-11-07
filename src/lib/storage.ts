/**
 * localStorage that never throws. Safari with "Block All Cookies", private
 * modes and some in-app browsers throw SecurityError on any access; we'd
 * rather forget a preference than crash the page.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // storage blocked or full: fine, it's only a preference
    }
  },
};
