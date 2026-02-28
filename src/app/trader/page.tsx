// /src/app/trader/page.tsx
'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Layers, Bot, CandlestickChart, Settings2, Laptop, Smartphone, Wand2 } from "lucide-react";
import Link from "next/link";

const platforms = [
  {
    icon: <Layers className="w-8 h-8 text-primary" />,
    title: "Deriv Trader",
    description: "Plataforma web para negociação de opções e multiplicadores.",
    href: "/deriv-trader",
    comingSoon: false,
  },
  {
    icon: <Wand2 className="w-8 h-8 text-primary" />,
    title: "Deriv Trader 2.0",
    description: "Uma nova abordagem para trading com IA (Em Desenvolvimento).",
    href: "/deriv-trader-v2",
    comingSoon: false,
  },
  {
    icon: <CandlestickChart className="w-8 h-8 text-primary" />,
    title: "Deriv MT5 (MetaTrader 5)",
    description: "A plataforma padrão da indústria para negociação de CFDs.",
    href: "#",
    comingSoon: true,
  },
  {
    icon: <Bot className="w-8 h-8 text-primary" />,
    title: "Deriv Bot",
    description: "Crie, teste e use robôs de negociação automatizados.",
    href: "#",
    comingSoon: true,
  },
  {
    icon: <Settings2 className="w-8 h-8 text-primary" />,
    title: "Deriv X",
    description: "Plataforma multi-ativos altamente personalizável.",
    href: "#",
    comingSoon: true,
  },
  {
    icon: <Laptop className="w-8 h-8 text-primary" />,
    title: "SmartTrader",
    description: "Interface simples para negociação de opções digitais.",
    href: "#",
    comingSoon: true,
  },
  {
    icon: <Smartphone className="w-8 h-8 text-primary" />,
    title: "Deriv GO",
    description: "App móvel otimizado para negociação em movimento.",
    href: "#",
    comingSoon: true,
  }
];

function DerivPlatformsPageContent() {
  // A lógica de conexão desnecessária foi removida.
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Plataformas
        </h1>
      </div>
      <p className="text-muted-foreground">
        Explore as plataformas de negociação da Deriv para operar Opções, Multiplicadores e CFDs.
      </p>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {platforms.map((platform) => (
          <Card key={platform.title} className="flex flex-col">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              {platform.icon}
              <div className="flex-1">
                <CardTitle className="font-headline">{platform.title}</CardTitle>
                <CardDescription>{platform.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-end">
              <Button asChild className="w-full mt-4" disabled={platform.comingSoon}>
                {platform.comingSoon ? (
                    <span>Em Breve</span>
                ) : (
                    <Link href={platform.href!}>Abrir Plataforma</Link>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function DerivPlatformsPage() {
    // O Provider foi removido pois não é mais necessário.
    return (
        <DerivPlatformsPageContent />
    );
}
