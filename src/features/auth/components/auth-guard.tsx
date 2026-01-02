// /src/features/auth/components/auth-guard.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { useEffect, type ReactNode } from "react";

// Adicionamos as páginas públicas que não precisam de autenticação
const publicPaths = ["/login", "/signup", "/verify-email"];

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) {
      return; // Não faça nada enquanto o estado de autenticação está carregando
    }

    const pathIsPublic = publicPaths.includes(pathname);

    // CASO 1: Utilizador NÃO está logado
    if (!user) {
      // Se tentar aceder a uma página protegida, redireciona para o login
      if (!pathIsPublic) {
        router.replace("/login");
      }
      return;
    }

    // CASO 2: Utilizador ESTÁ logado
    // Se o email não foi verificado, redireciona para a página de verificação,
    // a menos que ele já esteja a tentar aceder a uma página pública.
    if (!user.emailVerified) {
        if (pathname !== "/verify-email") {
             router.replace("/verify-email");
        }
        return;
    }
    
    // Se o email foi verificado e ele tenta aceder a uma página pública (login/signup),
    // redireciona para o painel principal.
    if (user.emailVerified && pathIsPublic) {
      router.replace("/");
    }

  }, [user, loading, router, pathname]);


  // Se está a carregar, não renderize nada para evitar piscar de ecrã
  if (loading) {
    return null;
  }
  
  // Condições para renderizar o conteúdo:
  // 1. Utilizador não logado numa página pública.
  // 2. Utilizador logado e verificado numa página protegida.
  // 3. Utilizador logado mas não verificado, na página de verificação.
  const pathIsPublic = publicPaths.includes(pathname);
  if (
    (!user && pathIsPublic) ||
    (user && user.emailVerified && !pathIsPublic) ||
    (user && !user.emailVerified && pathname === '/verify-email')
  ) {
     return <>{children}</>;
  }

  // Se nenhuma condição for atendida, não renderize nada (durante redirecionamentos).
  return null;
}
