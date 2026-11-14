import { KingdomView } from "@/components/game/kingdom-view";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function KingdomPage() {
  await requireProfilePage();
  return <KingdomView />;
}
