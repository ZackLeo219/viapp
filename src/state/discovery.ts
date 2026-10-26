import { authorizedDevices, identifyHid, identifySerial } from '../protocols/discovery';
import { isWorkspaceBusy, useWorkspace } from './workspace';

// Permission requests only happen in explicit click handlers. Scans use existing grants.
export function watchDevices(): () => void {
  let stopped = false,
    running = false,
    pending = false;
  let attempted = new WeakSet<object>();
  const pump = async () => {
    if (stopped || running || isWorkspaceBusy(useWorkspace.getState())) return;
    running = true;
    try {
      while (pending && !stopped) {
        pending = false;
        const devices = await authorizedDevices();
        for (const access of devices) {
          const state = useWorkspace.getState();
          if (stopped) break;
          if (isWorkspaceBusy(state)) {
            pending = true;
            break;
          }
          const existing = state.sessions[access.model];
          const handle = access.transport === 'hid' ? access.device : access.port;
          if (
            existing?.connection === 'device' ||
            existing?.connection === 'demo' ||
            state.autoConnectBlocked.includes(access.model) ||
            attempted.has(handle)
          )
            continue;
          attempted.add(handle);
          await state.connect(access.model, false, { access, automatic: true });
        }
        if (isWorkspaceBusy(useWorkspace.getState())) break;
      }
    } finally {
      running = false;
    }
  };
  const schedule = () => {
    pending = true;
    queueMicrotask(() => {
      void pump();
    });
  };
  const onConnect = (event: Event) => {
    const source = event as Event & { device?: HIDDevice; port?: SerialPort };
    const port = source.port ?? source.target;
    const access = source.device
      ? identifyHid(source.device)
      : port && 'getInfo' in port
        ? identifySerial(port as SerialPort)
        : null;
    if (access)
      useWorkspace.setState((s) => ({
        autoConnectBlocked: s.autoConnectBlocked.filter((m) => m !== access.model),
      }));
    attempted = new WeakSet();
    schedule();
  };
  const unsubscribe = useWorkspace.subscribe((state, previous) => {
    if (!isWorkspaceBusy(state) && isWorkspaceBusy(previous) && pending) schedule();
  });
  navigator.hid?.addEventListener('connect', onConnect);
  navigator.serial?.addEventListener('connect', onConnect);
  schedule();
  return () => {
    stopped = true;
    unsubscribe();
    navigator.hid?.removeEventListener('connect', onConnect);
    navigator.serial?.removeEventListener('connect', onConnect);
  };
}
