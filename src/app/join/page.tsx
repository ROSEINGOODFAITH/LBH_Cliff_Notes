import { brandConfig } from "@/lib/brand";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `${brandConfig.brandName} Creator Program`,
};

export default function JoinPage() {
  return (
    <main className="aurora flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">{brandConfig.brandName} Creator Program</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Join our affiliate program and get a unique discount code to share with your audience —
            earn commission on every order.
          </p>
        </div>
        <JoinForm />
        <p className="text-center text-xs text-muted-foreground">
          You&apos;ll receive a personal code that gives your followers a discount and tracks your
          referrals. A member of our team will activate it shortly.
        </p>
      </div>
    </main>
  );
}
