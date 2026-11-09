"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

// Each screen shows one main button; its other actions sit behind "More". On a computer
// they drop down under the button; on a phone they slide up from the bottom, in thumb
// reach. Closes on Escape, a tap outside, after following a link in it, or when an action
// in it lands on a new page (or on this one with a message).
export function MoreMenu({
  children,
  label = "More",
  defaultOpen = false,
}: {
  children: React.ReactNode;
  label?: string;
  defaultOpen?: boolean;
}) {
  // Open only at the address it was opened at, so it closes by itself after navigating.
  const here = `${usePathname()}?${useSearchParams().toString()}`;
  const [openAt, setOpenAt] = useState<string | null>(defaultOpen ? here : null);
  const open = openAt === here;
  const setOpen = (next: boolean | ((was: boolean) => boolean)) =>
    setOpenAt((at) => ((typeof next === "function" ? next(at === here) : next) ? here : null));
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenAt(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="more-menu" ref={ref}>
      <button
        type="button"
        className="btn secondary small more-menu-toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <span aria-hidden="true" className="more-menu-caret">
          ▾
        </span>
      </button>
      {open && (
        <>
          <div className="more-menu-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            id={panelId}
            className="more-menu-panel"
            role="group"
            aria-label={`${label} actions`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
