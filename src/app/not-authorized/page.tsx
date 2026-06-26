import { SignOutButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export default function NotAuthorizedPage() {
  return (
    <main className="aurora flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold tracking-tight">Not on the team</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This account isn&apos;t on the Laurel Bath House allowlist. Ask an admin to add your email
          to <code className="rounded bg-muted px-1 py-0.5">brand.config.ts → teamEmails</code>.
        </p>
        <div className="mt-6">
          <SignOutButton>
            <Button variant="outline">Sign out</Button>
          </SignOutButton>
        </div>
      </div>
    </main>
  );
}
