import { useUi, type MenuItem } from '../../store/ui.js';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Right-click menu rendered once at the app root; anything can open it with `useUi.getState().showMenu`. */
export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const hide = useUi((s) => s.hideMenu);
  if (!menu) return null;
  return (
    <DropdownMenu open onOpenChange={(o) => !o && hide()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={0} className="min-w-[210px]" onContextMenu={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
        {menu.items.map((item, i) =>
          item.separator ? (
            <DropdownMenuSeparator key={i} />
          ) : item.checked !== undefined ? (
            <DropdownMenuCheckboxItem key={i} checked={item.checked} disabled={item.disabled} onSelect={() => item.onClick?.()}>
              {item.label}
            </DropdownMenuCheckboxItem>
          ) : (
            <DropdownMenuItem key={i} variant={item.danger ? 'destructive' : 'default'} disabled={item.disabled} onSelect={() => item.onClick?.()}>
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
