/**
 * How many pages we've shown in this tab without a full reload. Client-side
 * navigations don't update document.referrer, so this is the reliable way to
 * know whether "Back" stays inside the app.
 */
let depth = 0;
export const navHistory = {
  visited() {
    depth++;
  },
  canGoBack() {
    return depth > 1;
  },
};
