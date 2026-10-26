import { flushSync } from 'react-dom';

let active: ViewTransition | undefined;
let revision = 0;

export function transitionWorkspace(update: () => void) {
  const ticket = ++revision;
  active?.skipTransition();
  let updated = false;
  const commit = () => {
    if (updated || ticket !== revision) return;
    updated = true;
    flushSync(update);
  };
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commit();
    return;
  }
  try {
    const transition = document.startViewTransition(commit);
    active = transition;
    // A skipped animation must never skip navigation or produce an unhandled rejection.
    void transition.ready.catch(() => {});
    void transition.updateCallbackDone.catch(commit);
    void transition.finished
      .catch(() => {})
      .then(() => {
        if (active === transition) active = undefined;
      });
  } catch {
    commit();
  }
}
