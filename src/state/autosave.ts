import { isAutoSavePending, useWorkspace } from './workspace';

// Coalesce deliberate edits; reads, navigation and reconnects never request a write.
export function watchAutoSave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduledDraft = useWorkspace.getState().draft;
  const schedule = () => {
    const state = useWorkspace.getState();
    if (state.operation !== 'idle' || !isAutoSavePending(state)) {
      clearTimeout(timer);
      timer = undefined;
      return;
    }
    if (timer !== undefined && scheduledDraft === state.draft) return;
    clearTimeout(timer);
    scheduledDraft = state.draft;
    timer = setTimeout(() => {
      timer = undefined;
      void useWorkspace.getState().apply({ automatic: true });
    }, 350);
  };
  const unsubscribe = useWorkspace.subscribe(schedule);
  schedule();
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
