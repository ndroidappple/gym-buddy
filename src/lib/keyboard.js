/* The on-screen keyboard and the bars pinned to the bottom of the screen (rest timer, Finish, tab
   bar, toasts). Runs once, on touch screens.

   While a field is being typed in, the rest timer and Finish step aside (<html data-typing>): newer
   iOS shrinks the viewport with the keyboard, so they'd ride up on top of it, over the very field.

   After the keyboard goes, iOS 26 can leave the viewport short (WebKit bug 297779): everything pinned
   to the bottom stays up where the keyboard's top edge was, floating over the page until Safari is
   restarted. --kb-stuck is how far the viewport is still short of its height before the keyboard, and
   the bottom bars sit that much lower, back on the real bottom edge. It's only set after a keyboard,
   and clears the moment iOS gives the viewport back. */

const isField = (n) => !!n && /^(INPUT|TEXTAREA)$/.test(n.tagName) && !/^(checkbox|radio|button|submit|range|file)$/.test(n.type);
// The keyboard's slide down, with room to spare. iOS reports the new viewport only once it's down,
// so until then a short viewport is still the keyboard leaving, not stuck.
const SETTLE_MS = 700;

export function installKeyboardWatch() {
  const vv = window.visualViewport;
  if (!vv || !matchMedia("(pointer: coarse)").matches) return;
  const root = document.documentElement;
  let full = 0; // the viewport's height with no keyboard up
  let after = false; // a keyboard was up, and the viewport hasn't been back to full since
  let settling = 0; // when the keyboard that just went down will be down
  let width = innerWidth;
  let frame = 0, wait = 0;
  const fit = () => {
    frame = 0;
    // Turned the phone: the old height means nothing now.
    if (innerWidth !== width) { width = innerWidth; full = 0; after = false; }
    const h = Math.min(innerHeight, vv.offsetTop + vv.height);
    const typing = isField(document.activeElement);
    if (typing) after = true;
    else {
      if (h >= full - 1) { after = false; settling = 0; }
      if (!after) full = h;
    }
    const aside = typing || Date.now() < settling;
    const stuck = aside || !after ? 0 : Math.round(full - h);
    root.toggleAttribute("data-typing", aside);
    if (stuck) root.style.setProperty("--kb-stuck", `${stuck}px`);
    else root.style.removeProperty("--kb-stuck");
  };
  const soon = () => { if (!frame) frame = requestAnimationFrame(fit); };
  addEventListener("focusin", soon);
  addEventListener("focusout", (e) => {
    if (!isField(e.target)) return;
    settling = Date.now() + SETTLE_MS;
    clearTimeout(wait);
    wait = setTimeout(soon, SETTLE_MS + 20);
    soon();
  });
  vv.addEventListener("resize", soon);
  vv.addEventListener("scroll", soon);
  addEventListener("resize", soon);
  // The stuck offset can change as the page scrolls, and scrolling sometimes clears it.
  addEventListener("scroll", soon, { passive: true });
  fit();
}
