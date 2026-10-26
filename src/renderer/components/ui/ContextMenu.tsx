import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUi, type MenuItem } from '../../store/ui.js';

/** Right-click menu rendered once at the app root; anything can open it with `useUi.getState().showMenu`. */
export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const hide = useUi((s) => s.hideMenu);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const w = box.current?.offsetWidth ?? 200;
    const h = box.current?.offsetHeight ?? 200;
    setPos({ left: Math.max(4, Math.min(menu.x, window.innerWidth - w - 4)), top: Math.max(4, Math.min(menu.y, window.innerHeight - h - 4)) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && box.current?.contains(e.target as Node)) return;
      hide();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, [menu, hide]);

  if (!menu) return null;
  return createPortal(
    <div className="context-menu" role="menu" ref={box} style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) =>
        item.separator ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            disabled={item.disabled}
            onClick={() => {
              hide();
              item.onClick?.();
            }}
          >
            <span className="check">{item.checked ? '✓' : ''}</span>
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Convenience: `onContextMenu={menuFor(() => [...])}` */
export function menuFor(items: () => MenuItem[]): (e: React.MouseEvent) => void {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    useUi.getState().showMenu(e.clientX, e.clientY, items());
  };
}
