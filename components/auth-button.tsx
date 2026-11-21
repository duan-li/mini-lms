import Link from "next/link";
import { Button } from "./ui/button";
import { LogoutButton } from "./logout-button";
import { getViewer } from "@/lib/auth/viewer";

export async function AuthButton() {
  const viewer = await getViewer();

  return viewer ? (
    <div className="flex items-center gap-4">
      <span className="hidden text-muted-foreground sm:inline">{viewer.email}</span>
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2">
      <Button asChild size="sm" variant={"outline"}>
        <Link href="/auth/login">Sign in</Link>
      </Button>
      <Button asChild size="sm" variant={"default"}>
        <Link href="/auth/sign-up">Sign up</Link>
      </Button>
    </div>
  );
}
