import { RivalView } from "@/components/game/rival-view";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function RivalPage() {
  await requireProfilePage();
  return <RivalView />;
}
