import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import type { LucideIcon } from 'lucide-react';

/**
 * Doc 09 §ContextMenu + Doc 11 §Context Menus.
 *
 * A single cursor-positioned menu, mounted once via `ContextMenuProvider` at
 * the workspace root so only one menu is ever open. Components call
 * `useContextMenu().showContextMenu(e, items)` from an `onContextMenu`
 * handler; the resolver that produces `items` is the "intelligent" part
 * (see `navigatorMenu.ts` and the bubble components).
 */

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** Label renders in `--color-error` (Doc 11 §Destructive items). */
  destructive?: boolean;
  /** Renders a 1px separator instead of an item; other fields ignored. */
  separator?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface ContextMenuApi {
  /** Open the menu at the event's cursor position. No-op for an empty list. */
  showContextMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  hideContextMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

/** Consumer hook — returns the trigger API of the workspace-root provider. */
export function useContextMenu(): ContextMenuApi {
  const api = useContext(ContextMenuContext);
  if (api === null) {
    throw new Error('useContextMenu must be used within a ContextMenuProvider');
  }
  return api;
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const showContextMenu = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    // Empty resolver result → suppress the menu entirely (Doc 11: e.g. session
    // user bubbles, streaming bubbles).
    if (items.length === 0) {
      setMenu(null);
      return;
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const hideContextMenu = useCallback(() => setMenu(null), []);

  const api = useMemo<ContextMenuApi>(
    () => ({ showContextMenu, hideContextMenu }),
    [showContextMenu, hideContextMenu],
  );

  return (
    <ContextMenuContext.Provider value={api}>
      {children}
      {menu !== null && <ContextMenuView menu={menu} onClose={hideContextMenu} />}
    </ContextMenuContext.Provider>
  );
}

const VIEWPORT_MARGIN = 8;

function ContextMenuView({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const [shown, setShown] = useState(false);

  // Flip away from viewport edges once the menu has measured itself.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    let x = menu.x;
    let y = menu.y;
    if (x + width > window.innerWidth - VIEWPORT_MARGIN) {
      x = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    }
    if (y + height > window.innerHeight - VIEWPORT_MARGIN) {
      y = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    }
    setPos({ x, y });
    setShown(true);
  }, [menu]);

  // Close on outside click, Escape (captured — does not reach the Escape
  // Chain, Doc 11), scroll, and resize.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top: pos.y, left: pos.x }}
      className={`z-[60] min-w-[200px] origin-top-left overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 font-sans text-[12px] text-[var(--color-text-primary)] shadow-lg transition-[opacity,transform] duration-150 ease-out ${
        shown ? 'scale-100 opacity-100' : 'scale-[0.96] opacity-0'
      }`}
    >
      {menu.items.map((item, i) =>
        item.separator === true ? (
          <hr key={i} className="my-1 border-t border-[var(--color-border-subtle)]" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 disabled:cursor-default disabled:opacity-40 enabled:hover:bg-[var(--color-bg-hover)] ${
              item.destructive === true
                ? 'text-[var(--color-error)]'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {item.icon !== undefined && <item.icon size={14} aria-hidden className="shrink-0" />}
            <span className="truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
