import { StartForm } from "@/components/start-form";
import { requireNoProfilePage } from "@/server/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function StartPage() {
  await requireNoProfilePage();
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-8">
      <StartForm />
    </main>
  );
}
