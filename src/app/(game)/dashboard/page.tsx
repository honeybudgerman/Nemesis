import { ThroneRoom } from "@/components/game/throne-room";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireProfilePage();
  return <ThroneRoom />;
}
