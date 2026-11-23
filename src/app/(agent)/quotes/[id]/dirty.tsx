"use client";

import { createContext, useContext, useMemo, useState } from "react";

// Whether the quote's settings form (client, language, message, markup) holds something typed
// and not saved yet. Sending, copying the link and Preview read the SAVED quote, so while this is
// true they are off: a markup typed and not saved would otherwise reach the client as net prices.
type Dirty = { dirty: boolean; setDirty: (dirty: boolean) => void };

const DirtyContext = createContext<Dirty>({ dirty: false, setDirty: () => {} });

export function QuoteDirtyProvider({ children, initialDirty = false }: { children: React.ReactNode; initialDirty?: boolean }) {
  const [dirty, setDirty] = useState(initialDirty);
  const value = useMemo(() => ({ dirty, setDirty }), [dirty]);
  return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

export function useQuoteDirty(): Dirty {
  return useContext(DirtyContext);
}
