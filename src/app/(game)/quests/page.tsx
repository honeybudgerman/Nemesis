import { QuestBoard } from "@/components/game/quest-board";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function QuestsPage() {
  await requireProfilePage();
  return <QuestBoard />;
}
