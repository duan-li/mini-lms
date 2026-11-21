import { redirect } from "next/navigation";

// The dashboard checks the session itself; signed-out visitors are sent on
// to the login page by proxy.ts.
export default function Home() {
  redirect("/dashboard");
}
