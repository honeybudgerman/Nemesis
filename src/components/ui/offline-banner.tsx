"use client";

import { useOnline } from "@/hooks/use-online";
import { OFFLINE_MESSAGE } from "@/lib/api-client";

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="border-b-2 border-danger bg-[#2a1216] px-4 py-2 text-center text-sm text-[#f3c0c2]">
      {OFFLINE_MESSAGE}
    </div>
  );
}
