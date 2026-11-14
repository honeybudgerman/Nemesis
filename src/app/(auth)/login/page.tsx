import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 py-10">
      <Link href="/" className="font-pixel text-3xl text-gold tracking-widest">NEMESIS</Link>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
