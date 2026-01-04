// /src/app/login/page.tsx
import { LoginForm } from "@/features/auth/components/login-form";
import { Logo } from "@/components/icons";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
            <Logo className="w-12 h-12 text-primary mb-4" />
            <h1 className="text-2xl font-bold tracking-tight font-headline">
                Bem-vindo de volta
            </h1>
            <p className="text-muted-foreground">
                Faça login para acessar seu painel financeiro.
            </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
