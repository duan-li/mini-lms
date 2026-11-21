"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const logout = async () => {
    setPending(true);
    await createClient().auth.signOut();
    // The provider also clears on SIGNED_OUT; clearing here as well means no
    // cached list survives even if that event is missed.
    queryClient.clear();
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <Button size="sm" variant="outline" onClick={logout} disabled={pending}>
      {pending ? "Logging out…" : "Logout"}
    </Button>
  );
}
