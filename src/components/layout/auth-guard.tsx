// /src/components/layout/auth-guard.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { useEffect, type ReactNode } from "react";

const publicPaths = ["/login", "/signup"];

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) {
      return; // Não faça nada enquanto o estado de autenticação está carregando
    }

    const pathIsPublic = publicPaths.includes(pathname);

    // Se o usuário não estiver logado e tentar acessar uma página protegida, redirecione para o login
    if (!user && !pathIsPublic) {
      router.replace("/login");
    }

    // Se o usuário estiver logado e tentar acessar uma página pública (login/signup), redirecione para o painel
    if (user && pathIsPublic) {
      router.replace("/");
    }
  }, [user, loading, router, pathname]);


  // Enquanto carrega, não renderize nada para evitar piscar a tela
  if (loading) {
    return null;
  }
  
  const pathIsPublic = publicPaths.includes(pathname);
  
  // Renderiza o conteúdo se as condições de rota e autenticação forem atendidas
  if ((!user && pathIsPublic) || (user && !pathIsPublic)) {
     return <>{children}</>;
  }

  // Se nenhuma das condições acima for atendida (por exemplo, durante um redirecionamento), não renderize nada
  return null;
}
