import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Cpu,
  Layers3,
  LayoutTemplate,
  Plus,
  Trash2,
} from 'lucide-react';
import { useWorkspace, isDirty, isWorkspaceBusy } from '../state/workspace';
import { Keyboard } from './Keyboard';
import { Modal } from './Modal';
import { snapshotOptions, optionValues, setOption } from '../domain/via-definition';
import './DeviceSettings.css';

export function DeviceSettings() {
  const s = useWorkspace();
  const [copy, setCopy] = useState<number | null>(null);
  const [target, setTarget] = useState(0);
  const [remove, setRemove] = useState<number | null>(null);
  const [resolve, setResolve] = useState<'save' | 'discard' | null>(null);
  const editable = s.draft.protocol === 'zmk' && !!s.draft.deviceInfo?.layerCapacity;
  const busy = isWorkspaceBusy(s);
  const blocked = busy || s.draft.locked;
  const info = s.baseline.deviceInfo;
  const capacity = info?.layerCapacity ?? s.draft.layers.length;
  const macroUsed = s.draft.macros.reduce((n, m) => n + m.length + 1, 0);
  const layoutOptions = snapshotOptions(s.draft);
  const choices = optionValues(layoutOptions, s.draft.layoutOptions);
  return (
    <div className="settings-grid">
      <div className="settings-main">
        <section className="panel settings-section">
          <div className="panel-heading">
            <h2>
              <Layers3 size={18} />
              图层
            </h2>
            <span className="settings-counter">
              {s.draft.layers.length}
              {editable ? ` / ${capacity}` : ''}
            </span>
          </div>
          <div className={`settings-layer-list ${editable ? '' : 'fixed-layers'}`}>
            {s.draft.layers.map((layer, index) => (
              <div className="settings-layer" key={layer.id} data-layer-id={layer.id}>
                <span className="layer-order">{String(index).padStart(2, '0')}</span>
                <div className="layer-identity">
                  <strong>{layer.name}</strong>
                </div>
                <div className="layer-row-actions">
                  <button
                    className="icon-button"
                    title="复制到其他层"
                    aria-label={`复制图层 ${layer.id}`}
                    disabled={blocked || s.draft.layers.length < 2}
                    onClick={() => {
                      setCopy(layer.id);
                      setTarget(s.draft.layers.find((l) => l.id !== layer.id)!.id);
                    }}
                  >
                    <Copy size={15} />
                  </button>
                  {editable && index > 0 && (
                    <>
                      <button
                        className="icon-button"
                        title="上移"
                        aria-label={`上移图层 ${layer.id}`}
                        disabled={blocked || index <= 1}
                        onClick={() => s.moveLayer(layer.id, -1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title="下移"
                        aria-label={`下移图层 ${layer.id}`}
                        disabled={blocked || index === s.draft.layers.length - 1}
                        onClick={() => s.moveLayer(layer.id, 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title="删除"
                        aria-label={`删除图层 ${layer.id}`}
                        disabled={blocked}
                        onClick={() => setRemove(layer.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {editable && capacity > s.draft.layers.length && (
            <div className="settings-section-footer">
              <button
                className="button"
                disabled={
                  blocked ||
                  s.connection === 'offline' ||
                  isDirty(s) ||
                  !!Object.keys(s.macroDrafts).length
                }
                onClick={() => void s.addLayer()}
              >
                <Plus size={16} />
                新增图层
              </button>
              {isDirty(s) && <span>先保存当前修改</span>}
            </div>
          )}
        </section>
        {s.draft.protocol === 'via' && layoutOptions.length > 0 && (
          <section className="panel settings-section">
            <div className="panel-heading">
              <div>
                <h2>
                  <LayoutTemplate size={18} />
                  物理配列
                </h2>
                <p>选择实际安装的配列。</p>
              </div>
            </div>
            <div className="layout-options">
              {layoutOptions.map((item, group) => (
                <div className="layout-option" key={group}>
                  <span>{item.label}</span>
                  <div className="setting-segments" role="group" aria-label={item.label}>
                    {item.choices.map((option, index) => (
                      <button
                        key={option}
                        aria-pressed={choices[group] === index}
                        disabled={blocked}
                        onClick={() =>
                          s.setLayout(setOption(layoutOptions, s.draft.layoutOptions, group, index))
                        }
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="layout-preview">
              <Keyboard snapshot={s.draft} layerId={s.draft.layers[0].id} miniature />
            </div>
          </section>
        )}
        {s.draft.protocol === 'zmk' && s.draft.firmwareUnsaved && (
          <section className="panel settings-section">
            <div className="panel-heading">
              <div>
                <h2>键盘中有未保存修改</h2>
                <p>可保存当前设备配置，或恢复到上次保存。</p>
              </div>
            </div>
            <div className="settings-section-footer">
              <button
                className="button primary"
                disabled={blocked || s.connection === 'offline'}
                onClick={() => setResolve('save')}
              >
                保存到键盘
              </button>
              <button
                className="button"
                disabled={blocked || s.connection === 'offline'}
                onClick={() => setResolve('discard')}
              >
                撤销设备修改
              </button>
            </div>
          </section>
        )}
      </div>
      <aside className="panel settings-device">
        <div className="settings-device-art">
          <Keyboard snapshot={s.baseline} layerId={s.baseline.layers[0].id} miniature />
        </div>
        <h2>{s.draft.name}</h2>
        <p>
          {s.connection === 'demo'
            ? '演示设备'
            : s.connection === 'device'
              ? 'USB 已连接'
              : '设备未连接'}
        </p>
        <dl className="device-facts">
          <div>
            <dt>按键</dt>
            <dd>{s.draft.keys.length}</dd>
          </div>
          <div>
            <dt>图层</dt>
            <dd>{s.draft.layers.length}</dd>
          </div>
          {!!s.draft.macros.length && (
            <>
              <div>
                <dt>宏槽位</dt>
                <dd>{s.draft.macros.length}</dd>
              </div>
              <div>
                <dt>宏空间</dt>
                <dd>
                  {macroUsed} / {s.draft.macroBufferSize - 1} B
                </dd>
              </div>
            </>
          )}
          {info?.firmware && (
            <div>
              <dt>固件标识</dt>
              <dd>{info.firmware}</dd>
            </div>
          )}
          {s.draft.protocol === 'zmk' && (
            <div>
              <dt>编辑状态</dt>
              <dd>{s.draft.locked ? '已锁定' : '已解锁'}</dd>
            </div>
          )}
        </dl>
        <details className="device-details">
          <summary>
            <Cpu size={15} />
            连接信息
          </summary>
          <dl className="device-facts">
            <div>
              <dt>协议</dt>
              <dd>
                {s.draft.protocol === 'via' ? `VIA ${s.draft.protocolVersion}` : 'ZMK Studio'}
              </dd>
            </div>
            <div>
              <dt>USB ID</dt>
              <dd>
                {s.draft.identity.startsWith('DEMO')
                  ? '演示'
                  : s.draft.identity.split(':').slice(0, 2).join(':')}
              </dd>
            </div>
          </dl>
        </details>
        {s.draft.viaDefinition?.extraFeatures && (
          <p className="device-feature-note">灯效与旋钮暂请使用原厂工具。</p>
        )}
      </aside>
      <Modal
        open={copy !== null}
        onOpenChange={(open) => !open && setCopy(null)}
        title="复制图层"
        description="覆盖目标层的按键，确认保存后生效。"
      >
        <label className="binding-field">
          <span>复制到</span>
          <select
            aria-label="复制到图层"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          >
            {s.draft.layers
              .filter((l) => l.id !== copy)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>
        <div className="modal-actions">
          <button className="button" onClick={() => setCopy(null)}>
            取消
          </button>
          <button
            className="button primary"
            disabled={blocked}
            onClick={() => {
              if (copy !== null) s.copyLayer(copy, target);
              setCopy(null);
            }}
          >
            <Copy size={15} />
            复制
          </button>
        </div>
      </Modal>
      <Modal
        open={remove !== null}
        onOpenChange={(open) => !open && setRemove(null)}
        title="删除图层"
        description="确认保存后删除；写入前会自动备份。"
      >
        <div className="modal-actions">
          <button className="button" onClick={() => setRemove(null)}>
            保留
          </button>
          <button
            className="button primary"
            disabled={blocked}
            onClick={() => {
              if (remove !== null) s.removeLayer(remove);
              setRemove(null);
            }}
          >
            删除
          </button>
        </div>
      </Modal>
      <Modal
        open={resolve !== null}
        onOpenChange={(open) => !open && setResolve(null)}
        title={resolve === 'save' ? '保存设备配置' : '撤销设备修改'}
        description="当前配置会先备份到此浏览器。"
      >
        <div className="modal-actions">
          <button className="button" onClick={() => setResolve(null)}>
            取消
          </button>
          <button
            className="button primary"
            disabled={blocked}
            onClick={() => {
              void s.resolveDeviceChanges(resolve === 'save');
              setResolve(null);
            }}
          >
            <Check size={15} />
            确认
          </button>
        </div>
      </Modal>
    </div>
  );
}
