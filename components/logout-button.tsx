"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const logout = async () => {
    setPending(true);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) {
        toast.error("Could not log out. Please try again.");
        return;
      }
      // The provider also clears on SIGNED_OUT; clearing here as well means no
      // cached list survives even if that event is missed.
      queryClient.clear();
      router.replace("/auth/login");
      router.refresh();
    } finally {
      // Always reset. Next keeps the dashboard layout mounted (hidden) after
      // navigating away, so this same button comes back when the next user
      // signs in; a stuck "Logging out…" would leave them unable to log out.
      setPending(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={logout} disabled={pending}>
      {pending ? "Logging out…" : "Logout"}
    </Button>
  );
}
