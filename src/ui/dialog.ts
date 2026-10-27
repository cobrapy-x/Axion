// SPDX-License-Identifier: Apache-2.0
/**
 * A small in-app confirm dialog. `window.confirm()` is not shown by every desktop webview
 * (Tauri on macOS), so Axion asks with its own <dialog> instead.
 */
export function askConfirm(message: string, ok = 'OK', cancel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    const text = document.createElement('p');
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'row';
    const no = document.createElement('button');
    no.className = 'btn';
    no.textContent = cancel;
    const yes = document.createElement('button');
    yes.className = 'btn primary';
    yes.textContent = ok;
    row.append(no, yes);
    dlg.append(text, row);
    document.body.append(dlg);
    const done = (v: boolean) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    dlg.showModal();
    yes.focus();
  });
}
