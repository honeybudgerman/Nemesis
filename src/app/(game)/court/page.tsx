import { CourtView } from "@/components/game/court-view";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function CourtPage() {
  await requireProfilePage();
  return <CourtView />;
}
