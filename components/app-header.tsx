import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";

export function AppHeader() {
  return (
    <header className="w-full border-b border-b-foreground/10">
      <nav className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 text-sm">
        <Link href="/dashboard" className="font-semibold">
          Mini-LMS
        </Link>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          {/* Reads the session, so it streams in after the static shell. */}
          <Suspense fallback={<div className="h-9 w-40" aria-hidden />}>
            <AuthButton />
          </Suspense>
        </div>
      </nav>
    </header>
  );
}
