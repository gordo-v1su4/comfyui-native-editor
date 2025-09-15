import React from "react";

interface EditorShellProps {
  sidebar: React.ReactNode;
  player: React.ReactNode;
  inspector: React.ReactNode;
  timeline: React.ReactNode;
}

/**
 * CapCut/Final Cut–style editor shell.
 * Grid areas:
 *  [ Sidebar | Player | Inspector ]
 *  [ Timeline (full width)       ]
 */
type PanelKey = 'sidebar' | 'player' | 'inspector' | 'timeline';

export const EditorShell: React.FC<EditorShellProps> = ({
  sidebar,
  player,
  inspector,
  timeline,
}) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [sidebarW, setSidebarW] = React.useState<number>(() => {
    const v = Number(localStorage.getItem("editor.sidebarWidth") || 300);
    return Math.min(Math.max(v || 300, 220), 600);
  });
  const [inspectorW, setInspectorW] = React.useState<number>(() => {
    const v = Number(localStorage.getItem("editor.inspectorWidth") || 360);
    return Math.min(Math.max(v || 360, 260), 640);
  });
  const [timelineH, setTimelineH] = React.useState<number>(() => {
    const v = Number(localStorage.getItem("editor.timelineHeight") || 280);
    return Math.min(Math.max(v || 280, 200), 600);
  });

  const saveSizes = (sw: number, iw: number, th: number) => {
    localStorage.setItem("editor.sidebarWidth", String(sw));
    localStorage.setItem("editor.inspectorWidth", String(iw));
    localStorage.setItem("editor.timelineHeight", String(th));
  };

  // ===== Dockable order (drag to reorder top-row panels) =====
  const [order, setOrder] = React.useState<PanelKey[]>(() => {
    const raw = localStorage.getItem('editor.layoutOrder');
    const def: PanelKey[] = ['sidebar','player','inspector','timeline'];
    if (!raw) return def;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.every(k => ['sidebar','player','inspector','timeline'].includes(k))) {
        return arr as PanelKey[];
      }
    } catch {}
    return def;
  });

  const persistOrder = (arr: PanelKey[]) => {
    localStorage.setItem('editor.layoutOrder', JSON.stringify(arr));
  };

  const [dragKey, setDragKey] = React.useState<PanelKey | null>(null);
  const onDragStart = (key: PanelKey) => (e: React.DragEvent) => {
    setDragKey(key);
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (overKey: PanelKey) => (e: React.DragEvent) => {
    e.preventDefault();
    const src = (dragKey || (e.dataTransfer.getData('text/plain') as PanelKey)) as PanelKey;
    if (!src || src === overKey) return;
    const arr = [...order];
    const si = arr.indexOf(src);
    const di = arr.indexOf(overKey);
    if (si < 0 || di < 0) return;
    arr.splice(si, 1);
    arr.splice(di, 0, src);
    setOrder(arr);
    persistOrder(arr);
    setDragKey(null);
  };

  // Drop hover indicator
  const [overKey, setOverKey] = React.useState<PanelKey | null>(null);
  const onDragEnter = (key: PanelKey) => (e: React.DragEvent) => {
    e.preventDefault();
    setOverKey(key);
  };
  const onDragLeave = (key: PanelKey) => (e: React.DragEvent) => {
    e.preventDefault();
    if (overKey === key) setOverKey(null);
  };

  // Collapse state per container
  const [collapsedLeft, setCollapsedLeft] = React.useState<boolean>(false);
  const [collapsedRight, setCollapsedRight] = React.useState<boolean>(false);
  const [collapsedBottom, setCollapsedBottom] = React.useState<boolean>(false);
  const lastSidebarW = React.useRef<number>(sidebarW);
  const lastInspectorW = React.useRef<number>(inspectorW);
  const lastTimelineH = React.useRef<number>(timelineH);

  const toggleLeft = () => {
    if (!collapsedLeft) {
      lastSidebarW.current = sidebarW;
      const w = 34;
      setSidebarW(w);
      saveSizes(w, inspectorW, timelineH);
      setCollapsedLeft(true);
    } else {
      const w = Math.max(220, lastSidebarW.current || 300);
      setSidebarW(w);
      saveSizes(w, inspectorW, timelineH);
      setCollapsedLeft(false);
    }
  };
  const toggleRight = () => {
    if (!collapsedRight) {
      lastInspectorW.current = inspectorW;
      const w = 34;
      setInspectorW(w);
      saveSizes(sidebarW, w, timelineH);
      setCollapsedRight(true);
    } else {
      const w = Math.max(260, lastInspectorW.current || 360);
      setInspectorW(w);
      saveSizes(sidebarW, w, timelineH);
      setCollapsedRight(false);
    }
  };
  const toggleBottom = () => {
    if (!collapsedBottom) {
      lastTimelineH.current = timelineH;
      const h = 34;
      setTimelineH(h);
      saveSizes(sidebarW, inspectorW, h);
      setCollapsedBottom(true);
    } else {
      const h = Math.max(200, lastTimelineH.current || 280);
      setTimelineH(h);
      saveSizes(sidebarW, inspectorW, h);
      setCollapsedBottom(false);
    }
  };

  // Drag handlers
  const startDragCol = (which: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const x = ev.clientX - rect.left; // within shell
      const minSidebar = 220;
      const minInspector = 260;
      const gutter = 6 + 6; // two resizers total width

      if (which === "left") {
        const maxSidebar = Math.max(220, rect.width - inspectorW - gutter - 400);
        const newW = Math.min(Math.max(x, minSidebar), maxSidebar);
        setSidebarW(newW);
        saveSizes(newW, inspectorW, timelineH);
      } else {
        const leftTotal = sidebarW + 6; // sidebar + first gutter
        const rightEdge = rect.width - x; // distance from right edge
        const newInspector = Math.min(
          Math.max(rightEdge, minInspector),
          Math.max(260, rect.width - leftTotal - 400)
        );
        setInspectorW(newInspector);
        saveSizes(sidebarW, newInspector, timelineH);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDragRow = (e: React.MouseEvent) => {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const y = ev.clientY - rect.top;
      // timeline is the bottom area; row layout is [top, gutter, timeline]
      const topMin = 200; // ensure preview row stays usable
      const bottomMin = 200;
      const total = rect.height;
      let newTimeline = Math.min(Math.max(total - y - 3, bottomMin), 600);
      const topHeight = total - newTimeline - 6; // minus gutter
      if (topHeight < topMin) newTimeline = total - topMin - 6;
      setTimelineH(newTimeline);
      saveSizes(sidebarW, inspectorW, newTimeline);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Map first and last columns to resizable widths; middle column flex
  const gridCols = `${Math.round(sidebarW)}px 6px 1fr 6px ${Math.round(inspectorW)}px`;
  const gridRows = `1fr 6px ${Math.round(timelineH)}px`;

  return (
    <div
      ref={rootRef}
      style={{
        display: "grid",
        gridTemplateColumns: gridCols,
        gridTemplateRows: gridRows,
        gridTemplateAreas: `
          'c1 v1 c2 v2 c3'
          'h1 h1 h1 h1 h1'
          'cBottom cBottom cBottom cBottom cBottom'
        `,
        gap: 6,
        height: "100%",
        padding: 8,
        boxSizing: "border-box",
        background: "#0e0f12",
        color: "#e5e7eb",
        overflow: "hidden",
      }}
    >
      {/* Column 1 */}
      <div style={{ gridArea: 'c1', minWidth: 220, overflow: 'hidden', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: 6 }}>
        <PanelChrome
          title={order[0] === 'sidebar' ? 'Media' : order[0] === 'player' ? 'Player' : 'Inspector'}
          onDragStart={onDragStart(order[0])}
          onDragOver={onDragOver}
          onDrop={onDrop(order[0])}
          onDragEnter={onDragEnter(order[0])}
          onDragLeave={onDragLeave(order[0])}
          isOver={overKey === order[0]}
          onToggleCollapse={toggleLeft}
          collapsed={collapsedLeft || sidebarW <= 40}
        >
          {order[0] === 'sidebar' ? sidebar : order[0] === 'player' ? player : inspector}
        </PanelChrome>
      </div>

      {/* Vertical resizer between sidebar and player */}
      <div
        style={{ gridArea: "v1", cursor: "col-resize", background: "#1b1e26", borderRadius: 3 }}
        onMouseDown={startDragCol("left")}
        title="Drag to resize"
      />

      {/* Column 2 (flex) */}
      <div style={{ gridArea: 'c2', minWidth: 420, overflow: 'hidden', background: 'var(--panel-bg-2)', border: '1px solid var(--panel-border)', borderRadius: 6 }}>
        <PanelChrome
          title={order[1] === 'sidebar' ? 'Media' : order[1] === 'player' ? 'Player' : 'Inspector'}
          onDragStart={onDragStart(order[1])}
          onDragOver={onDragOver}
          onDrop={onDrop(order[1])}
          onDragEnter={onDragEnter(order[1])}
          onDragLeave={onDragLeave(order[1])}
          isOver={overKey === order[1]}
        >
          {order[1] === 'sidebar' ? sidebar : order[1] === 'player' ? player : inspector}
        </PanelChrome>
      </div>

      {/* Vertical resizer between player and inspector */}
      <div
        style={{ gridArea: "v2", cursor: "col-resize", background: "#1b1e26", borderRadius: 3 }}
        onMouseDown={startDragCol("right")}
        title="Drag to resize"
      />

      {/* Column 3 */}
      <div style={{ gridArea: 'c3', minWidth: 260, overflow: 'hidden', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: 6 }}>
        <PanelChrome
          title={order[2] === 'sidebar' ? 'Media' : order[2] === 'player' ? 'Player' : 'Inspector'}
          onDragStart={onDragStart(order[2])}
          onDragOver={onDragOver}
          onDrop={onDrop(order[2])}
          onDragEnter={onDragEnter(order[2])}
          onDragLeave={onDragLeave(order[2])}
          isOver={overKey === order[2]}
          onToggleCollapse={toggleRight}
          collapsed={collapsedRight || inspectorW <= 40}
        >
          {order[2] === 'sidebar' ? sidebar : order[2] === 'player' ? player : inspector}
        </PanelChrome>
      </div>

      {/* Horizontal resizer above timeline */}
      <div
        style={{ gridArea: "h1", cursor: "row-resize", background: "#1b1e26", borderRadius: 3 }}
        onMouseDown={startDragRow}
        title="Drag to resize"
      />

      {/* Bottom panel (resizable) */}
      <div style={{ gridArea: 'cBottom', overflow: 'hidden', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: 6 }}>
        <PanelChrome
          title={order[3] === 'sidebar' ? 'Media' : order[3] === 'player' ? 'Player' : order[3] === 'inspector' ? 'Inspector' : 'Timeline'}
          onDragStart={onDragStart(order[3])}
          onDragOver={onDragOver}
          onDrop={onDrop(order[3])}
          onDragEnter={onDragEnter(order[3])}
          onDragLeave={onDragLeave(order[3])}
          isOver={overKey === order[3]}
          onToggleCollapse={toggleBottom}
          collapsed={collapsedBottom || timelineH <= 40}
        >
          {order[3] === 'sidebar' ? sidebar : order[3] === 'player' ? player : order[3] === 'inspector' ? inspector : timeline}
        </PanelChrome>
      </div>
    </div>
  );
};

// Simple panel chrome with a thin header used as drag handle
const PanelChrome: React.FC<{
  title: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  isOver?: boolean;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  children: React.ReactNode;
}> = ({ title, onDragStart, onDragOver, onDrop, onDragEnter, onDragLeave, isOver, onToggleCollapse, collapsed, children }) => {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        title="Drag to move panel"
        style={{
          fontSize: 11,
          color: 'var(--muted-text)',
          padding: '6px 8px',
          borderBottom: '1px solid var(--panel-border)',
          cursor: 'grab',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: isOver ? 'var(--panel-drag-over)' : 'transparent',
        }}
      >
        <span style={{ width: 10, height: 10, background: 'var(--panel-grip)', border: '1px solid var(--panel-border)', borderRadius: 2 }} />
        <span style={{ flex: 1 }}>{title}</span>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} style={{ padding: '2px 6px', fontSize: 10, background: 'var(--btn-bg)', color: 'var(--text)', border: '1px solid var(--panel-border)', borderRadius: 4, cursor: 'pointer' }}>
            {collapsed ? '▣' : '▢'}
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: collapsed ? 'none' : 'block' }}>{children}</div>
    </div>
  );
};

export default EditorShell;
