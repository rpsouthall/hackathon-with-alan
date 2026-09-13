"use client";

import { createContext } from "react";
import type { createWorldStore } from "@/lib/world/store";

// Keep context identity outside provider/runtime modules for development HMR.
export const WorldContext = createContext<ReturnType<typeof createWorldStore> | null>(null);
