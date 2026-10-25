// SPDX-License-Identifier: Apache-2.0
/** Minimal accessible dropdown: toggle button + popup, closes on outside click / Escape. */

export interface Dropdown {
  open(): void;
  close(focusButton?: boolean): void;
  readonly isOpen: boolean;
}

const openMenus = new Set<Dropdown>();

export function dropdown(button: HTMLElement, popup: HTMLElement, onOpen?: () => void): Dropdown {
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  popup.hidden = true;

  const items = () =>
    [...popup.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].filter(
      (e) => !(e as HTMLButtonElement).disabled && e.offsetParent !== null,
    );

  const api: Dropdown = {
    get isOpen() {
      return !popup.hidden;
    },
    open() {
      for (const m of openMenus) if (m !== api) m.close();
      onOpen?.();
      popup.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      openMenus.add(api);
      const current = popup.querySelector<HTMLElement>('[aria-checked="true"]') ?? items()[0];
      current?.focus({ preventScroll: true });
    },
    close(focusButton = false) {
      if (popup.hidden) return;
      popup.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      openMenus.delete(api);
      if (focusButton) button.focus();
    },
  };

  button.addEventListener('click', () => (api.isOpen ? api.close() : api.open()));
  popup.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't also clear the canvas selection
      api.close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      api.close();
    }
  });
  // Selecting an item closes the menu.
  popup.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[role="menuitem"], [role="menuitemradio"]')) api.close(true);
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (api.isOpen && !popup.contains(t) && !button.contains(t)) api.close();
  });
  return api;
}
