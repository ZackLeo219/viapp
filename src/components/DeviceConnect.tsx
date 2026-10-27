import { useEffect, useId, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowRight, Calculator, ChevronDown, Keyboard, LoaderCircle, Plus } from 'lucide-react';
import './DeviceConnect.css';

const connections = [
  {
    transport: 'hid',
    protocol: 'VIA',
    description: '自动识别键盘，也可导入 VIA JSON',
    icon: Keyboard,
  },
  {
    transport: 'serial',
    protocol: 'ZMK Studio',
    description: 'TOFU PAD 原装双模 PCB',
    icon: Calculator,
  },
] as const;

export function DeviceConnect({
  busy,
  onConnect,
}: {
  busy: boolean;
  onConnect(transport: 'hid' | 'serial'): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const requesting = useRef(false);
  const descriptionId = useId();
  useEffect(() => {
    if (busy) setOpen(false);
  }, [busy]);

  const connect = async (transport: 'hid' | 'serial') => {
    requesting.current = true;
    try {
      // Invoke the native picker in the menu selection's user gesture.
      await onConnect(transport);
    } finally {
      requesting.current = false;
      requestAnimationFrame(() => {
        if (document.hasFocus() && document.activeElement === document.body)
          trigger.current?.focus({ preventScroll: true });
      });
    }
  };

  return (
    <DropdownMenu.Root open={open && !busy} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          className="button primary hub-add-device"
          disabled={busy}
          data-testid="connect-device"
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
          {busy ? '正在连接' : '添加设备'}
          <ChevronDown className="connect-chevron" size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="connection-menu"
          side="top"
          align="center"
          sideOffset={12}
          collisionPadding={16}
          aria-labelledby={`${descriptionId}-title`}
          onCloseAutoFocus={(event) => {
            if (requesting.current) event.preventDefault();
          }}
        >
          <DropdownMenu.Label className="connection-menu-heading">
            <span id={`${descriptionId}-title`}>选择连接方式</span>
          </DropdownMenu.Label>
          {connections.map((connection) => (
            <DropdownMenu.Item
              key={connection.transport}
              className="connection-menu-item"
              textValue={connection.protocol}
              aria-label={`连接 ${connection.protocol}`}
              aria-describedby={`${descriptionId}-${connection.transport}`}
              data-testid={connection.transport === 'hid' ? 'connect-via' : 'connect-zmk'}
              onSelect={() => void connect(connection.transport)}
            >
              <span className="connection-menu-icon">
                <connection.icon size={19} />
              </span>
              <span className="connection-menu-copy">
                <strong>{connection.protocol}</strong>
                <small id={`${descriptionId}-${connection.transport}`}>
                  {connection.description}
                </small>
              </span>
              <ArrowRight className="connection-menu-arrow" size={16} />
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
