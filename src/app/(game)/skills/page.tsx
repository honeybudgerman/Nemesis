import { SkillsView } from "@/components/game/skills-view";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  await requireProfilePage();
  return <SkillsView />;
}
