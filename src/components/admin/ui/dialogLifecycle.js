const activeDialogs = new Set();
let previousOverflow;

// Native modal dialogs provide the top layer, background inertness and Tab trap.
// Keep the scroll lock until the last nested dialog closes.
export function openDialog(dialog, body, returnFocusRef) {
  const trigger = dialog.ownerDocument.activeElement;
  if (!activeDialogs.size) previousOverflow = body.style.overflow;
  activeDialogs.add(dialog);
  body.style.overflow = "hidden";
  dialog.showModal();
  return () => {
    dialog.close();
    activeDialogs.delete(dialog);
    if (!activeDialogs.size) body.style.overflow = previousOverflow;
    const target = returnFocusRef?.current || trigger;
    if (target?.isConnected && !target.disabled) target.focus();
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
