"use client";
// The hook every ticker search box uses (#553 COWORK #36). Rules: lib/listboxNav.ts.
import { useCallback, useEffect, useId, useState } from "react";
import type React from "react";
import { navKey, optionId } from "@/lib/listboxNav";

export type ListboxNav = {
  active: number;
  /** Call FIRST in the input's onKeyDown; true means the key was handled here. */
  onKeyDown: (e: React.KeyboardEvent) => boolean;
  inputAria: {
    role: "combobox";
    "aria-expanded": boolean;
    "aria-controls": string;
    "aria-autocomplete": "list";
    "aria-activedescendant": string | undefined;
  };
  listProps: { id: string; role: "listbox" };
  optionProps: (index: number) => {
    id: string;
    role: "option";
    "aria-selected": boolean;
    onMouseMove: () => void;
  };
};

export function useListboxNav(opts: {
  count: number;
  open: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  /** Anything that changes when the typed text changes: the highlight resets. */
  resetKey: unknown;
}): ListboxNav {
  const { count, open, onSelect, onClose, resetKey } = opts;
  const listId = `lbx-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [active, setActive] = useState(-1);

  // Typing (or a new result set) resets the highlight.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on an external change, the documented exception
  useEffect(() => { setActive(-1); }, [resetKey, open]);

  // The highlighted row stays in view when the list scrolls.
  useEffect(() => {
    if (active < 0 || typeof document === "undefined") return;
    document.getElementById(optionId(listId, active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const a = navKey(e.key, active, count, open);
    if (a.kind === "move") { e.preventDefault(); setActive(a.index); return true; }
    if (a.kind === "select") { e.preventDefault(); onSelect(a.index); setActive(-1); return true; }
    if (a.kind === "close") { if (a.preventDefault) e.preventDefault(); setActive(-1); onClose(); return true; }
    return false;
  }, [active, count, open, onSelect, onClose]);

  const cur = open && active >= 0 && active < count ? active : -1;
  return {
    active: cur,
    onKeyDown,
    inputAria: {
      role: "combobox",
      "aria-expanded": open && count > 0,
      "aria-controls": listId,
      "aria-autocomplete": "list",
      "aria-activedescendant": cur >= 0 ? optionId(listId, cur) : undefined,
    },
    listProps: { id: listId, role: "listbox" },
    optionProps: (index: number) => ({
      id: optionId(listId, index),
      role: "option",
      "aria-selected": index === cur,
      // mousemove, not mouseenter: a list scrolled by the keyboard under a
      // still pointer must not steal the highlight.
      onMouseMove: () => { if (index !== active) setActive(index); },
    }),
  };
}
