import { ChroniclesView } from "@/components/game/chronicles-view";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function ChroniclesPage() {
  await requireProfilePage();
  return <ChroniclesView />;
}
