import { MentorScreen } from "@/components/game/mentor-view";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function MentorPage() {
  await requireProfilePage();
  return <MentorScreen />;
}
