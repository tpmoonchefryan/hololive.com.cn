const activeDialogs = new Set();
let previousOverflow;

// Native modal dialogs provide the top layer, background inertness and Tab trap.
// Keep the scroll lock until the last nested dialog closes.
const controlsIn = dialog => [...dialog.querySelectorAll('button, a[href], input, select, textarea, iframe, [tabindex]')]
  .filter(item => validTarget(item) && item.tabIndex >= 0);
const topDialog = () => [...activeDialogs].at(-1);
const validTarget = target => target?.isConnected && !target.disabled && !target.matches?.(':disabled') &&
  !target.closest?.('[inert]') && target.getClientRects().length && target.ownerDocument.defaultView.getComputedStyle(target).visibility !== 'hidden';

export function openDialog(dialog, body, returnFocusRef) {
  const document = dialog.ownerDocument;
  const trigger = document.activeElement;
  if (!activeDialogs.size) previousOverflow = body.style.overflow;
  activeDialogs.add(dialog);
  body.style.overflow = "hidden";
  try { dialog.showModal(); } catch (error) {
    activeDialogs.delete(dialog);
    if (!activeDialogs.size) body.style.overflow = previousOverflow;
    throw error;
  }
  const repair = () => {
    if (topDialog() !== dialog || !dialog.open || !document.hasFocus()) return;
    const active = document.activeElement;
    // A native nested layer or a live iframe keeps its own focus.
    if (active?.closest?.('dialog[open]') && active.closest('dialog[open]') !== dialog) return;
    if (active !== dialog && dialog.contains(active) && validTarget(active)) return;
    (controlsIn(dialog)[0] || dialog).focus({ preventScroll: true });
  };
  const observer = new MutationObserver(repair);
  observer.observe(dialog, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['disabled', 'hidden', 'style', 'class', 'tabindex'] });
  document.addEventListener('focusin', repair);
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', repair);
    dialog.close();
    activeDialogs.delete(dialog);
    if (!activeDialogs.size) body.style.overflow = previousOverflow;
    const remaining = topDialog();
    const target = returnFocusRef?.current || trigger;
    if (document.hasFocus() && validTarget(target) && (!remaining || remaining.contains(target))) target.focus();
    else if (remaining && document.hasFocus()) (controlsIn(remaining)[0] || remaining).focus();
  };
}

export function isBackdropClick(event) {
  if (event.target !== event.currentTarget) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right ||
    event.clientY < rect.top || event.clientY > rect.bottom;
}

export function trapDialogTab(event) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const controls = [...dialog.querySelectorAll('button, a[href], input, select, textarea, iframe, [tabindex]')]
    .filter((item) => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length);
  const first = controls[0];
  const last = controls.at(-1);
  const active = dialog.ownerDocument.activeElement;
  if (!first || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
