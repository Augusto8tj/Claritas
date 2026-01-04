// /src/app/signup/page.tsx
import { SignupForm } from "@/features/auth/components/signup-form";
import { Logo } from "@/components/icons";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
            <Logo className="w-12 h-12 text-primary mb-4" />
            <h1 className="text-2xl font-bold tracking-tight font-headline">
                Crie sua conta
            </h1>
            <p className="text-muted-foreground">
                Comece a gerenciar suas finanças hoje mesmo.
            </p>
        </div>
        <SignupForm />
      </div>
    </div>
  );
}
