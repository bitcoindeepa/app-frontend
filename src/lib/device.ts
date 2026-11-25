/**
 * iPhone, iPad or iPod. iPadOS reports itself as a Mac, so touch points tell
 * an iPad from a real Mac. Browser only (reads navigator).
 */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)
  );
}
