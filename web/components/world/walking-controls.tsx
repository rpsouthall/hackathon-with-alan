"use client";
import { useEffect, useLayoutEffect, useState } from 'react';

import { HeldDirections, type HeldDirection as Direction } from '@/lib/world/held-directions';
const controls = [
  { label: 'Move forward', direction: [0, -1], symbol: '↑', column: 2 },
  { label: 'Move left', direction: [-1, 0], symbol: '←', column: 1 },
  { label: 'Move backward', direction: [0, 1], symbol: '↓', column: 2 },
  { label: 'Move right', direction: [1, 0], symbol: '→', column: 3 },
] as const;

/** Pointer capture keeps a held direction active until release, even outside its button. */
export function WalkingControls({ disabled, onDirection }: { disabled: boolean; onDirection: (direction: Direction) => void }) {
  const [held] = useState(() => new HeldDirections(onDirection));
  useLayoutEffect(() => { held.setOnChange(onDirection); }, [held, onDirection]);
  useEffect(() => {
    const clear = () => { held.clear(); };
    const visibility = () => { if (document.hidden) clear(); };
    if (disabled) clear();
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => { clear(); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); };
  }, [disabled, held]);
  return <nav className="walking-controls" aria-label="Walking controls">
    {controls.map((control, index) => <button key={control.label} type="button" aria-label={control.label} disabled={disabled}
      style={{ gridColumn: control.column, gridRow: index === 0 ? 1 : 2 }}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        held.hold(event.pointerId, [...control.direction]);
      }}
      onPointerUp={event => held.release(event.pointerId)} onPointerCancel={event => held.release(event.pointerId)} onLostPointerCapture={event => held.release(event.pointerId)}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); held.hold(control.label, [...control.direction]); } }}
      onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); held.release(control.label); } }}
      onBlur={() => held.release(control.label)}
    >{control.symbol}</button>)}
  </nav>;
}
