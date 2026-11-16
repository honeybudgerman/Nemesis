"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toasts } from "@/components/ui/toasts";
import { useUiStore } from "@/stores/ui-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 24 * 3600_000 },
          mutations: { retry: 0 },
        },
      }),
  );
  const motionOff = useUiStore((s) => s.motionOff);

  useEffect(() => {
    document.documentElement.dataset.motion = motionOff ? "off" : "on";
  }, [motionOff]);

  // A short 8-bit click for every pixel button (only when sound is on).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest(".pixel-btn") : null;
      if (el && !(el as HTMLButtonElement).disabled) useUiStore.getState().sfx("click");
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toasts />
    </QueryClientProvider>
  );
}
