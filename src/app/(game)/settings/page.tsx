import { SettingsView } from "@/components/game/settings-view";
import { requireProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user } = await requireProfilePage();
  return <SettingsView email={user.email ?? ""} />;
}
