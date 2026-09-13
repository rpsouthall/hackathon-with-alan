"use client";

import { useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createWorldStore } from "@/lib/world/store";
import { createLocalTransport, type WorldTransport } from "@/lib/world/transport";

import { WorldContext } from "./world-context";

export function WorldProvider({ children, transport, roomId = "courtyard", playerName = "Learner" }: {
  children: ReactNode; transport?: WorldTransport; roomId?: string; playerName?: string;
}) {
  const store = useMemo(() => createWorldStore(transport ?? createLocalTransport()), [transport]);
  useEffect(() => store.connect(roomId, playerName), [store, roomId, playerName]);
  return <WorldContext.Provider value={store}>{children}</WorldContext.Provider>;
}

export function useWorld() {
  const store = useContext(WorldContext);
  if (!store) throw new Error("useWorld must be used inside WorldProvider");
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { ...state, send: store.send, clearError: store.clearError, sendVoice: store.sendVoice, subscribeVoice: store.subscribeVoice };
}
