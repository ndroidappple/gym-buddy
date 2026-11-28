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

/* Stops iOS sliding the page to bring a field into view, for fields in a sheet (the chats, Add food,
   setup, the program editor's sheets...). A sheet already moves itself above the keyboard
   (useVisibleViewport in components/ui.jsx); iOS sliding the page too, on its own animation, made the
   two fight: the sheet dropped and climbed back as the keyboard came up, and jumped and fell as it went.

   iOS only slides when the field is where the keyboard will be. So for the one frame it decides, the
   field is drawn at the top of the screen; it's back in place on the next frame. The same trick React
   Aria uses. A tap that was really a scroll (the finger moved) is left alone, and so is a field that
   already has focus, so taps to move the caret work as usual. Fields on a page (a set's weight, the
   weigh-in) keep iOS's own scroll: the page scrolling to the field is the one movement there. */
const IOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
function installNoPan() {
  let start = null;
  addEventListener("touchstart", (e) => { const t = e.touches[0]; start = t ? { x: t.clientX, y: t.clientY } : null; }, { passive: true, capture: true });
  const lift = (el) => {
    const top = el.getBoundingClientRect().top;
    if (top < innerHeight / 3) return false; // already well clear of the keyboard: nothing to slide
    el.style.translate = `0 ${-top}px`;
    requestAnimationFrame(() => { el.style.translate = ""; }); // one frame: long enough for iOS to decide, too short to see
    return true;
  };
  // Bubble phase on the document, so a sheet's own touchend listener (it notes the tap) has already run.
  document.addEventListener("touchend", (e) => {
    const t = e.target, end = e.changedTouches[0];
    if (!isField(t) || t === document.activeElement || t.disabled || t.readOnly || !t.closest(".sheet-wrap")) return;
    if (start && end && Math.hypot(end.clientX - start.x, end.clientY - start.y) > 10) return;
    if (!lift(t)) return;
    e.preventDefault(); // no native focus (it would slide the page); focus it ourselves, unslid
    t.focus({ preventScroll: true });
  }, { passive: false });
  // Focus that didn't come from a tap on the field (the keyboard's next/previous arrows): same trick.
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (isField(t) && t.closest(".sheet-wrap") && !t.style.translate) lift(t);
  }, true);
}

export function installKeyboardWatch() {
  const vv = window.visualViewport;
  if (!vv || !matchMedia("(pointer: coarse)").matches) return;
  if (IOS) installNoPan();
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
