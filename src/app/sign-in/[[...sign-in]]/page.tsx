import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="aurora flex min-h-screen items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">LBH Cliff Notes</h1>
          <p className="text-sm text-muted-foreground">Laurel Bath House · Influencer CRM</p>
        </div>
        <SignIn />
      </div>
    </main>
  );
}
