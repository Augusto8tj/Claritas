// /src/components/layout/app-layout.tsx
'use client';

import { usePathname } from "next/navigation";
import {
  BarChart3,
  HelpCircle,
  LayoutDashboard,
  Settings,
  Sparkles,
  Target,
  User,
  PiggyBank,
  CandlestickChart,
  TestTube,
  Layers,
  ChevronDown,
  Bot,
  Settings2,
  Laptop,
  Smartphone,
  Activity,
  Trophy,
  PanelLeftClose,
  PanelRightClose,
  Archive,
  Wand2,
  Briefcase,
  BarChartHorizontal,
  Calculator,
  Crosshair,
  Zap,
  RefreshCw, // Importando o ícone
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter
} from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Logo } from "@/components/icons";
import { UserNav } from "@/components/auth/user-nav";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebar } from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import React from "react";
import Link from "next/link";
import { Button } from "../ui/button";


const navItems = [
  {
    href: "/",
    icon: LayoutDashboard,
    label: "Painel",
  },
  {
    href: "/analysis",
    icon: BarChart3,
    label: "Análise",
  },
   {
    href: "/budget",
    icon: PiggyBank,
    label: "Orçamento",
  },
  {
    href: "/goals",
    icon: Target,
    label: "Metas",
  },
   {
    href: "/portfolio",
    icon: Briefcase,
    label: "Portfólio",
  },
  {
    href: "/backtesting",
    icon: TestTube,
    label: "Backtesting",
  },
   {
    href: "/volatility-analysis",
    icon: Calculator,
    label: "Análise de Volatilidade",
  },
  {
    href: "/hf-strike-zone",
    icon: Zap,
    label: "HF Strike Zone",
  },
  {
    href: "/deriv-trader-reset", // NOVO LINK
    icon: RefreshCw,
    label: "Deriv Reset",
  },
  {
    href: "/deriv-trader-accumulators",
    icon: BarChartHorizontal,
    label: "Deriv Accumulators",
  },
  {
    href: "/deriv-trader-multipliers",
    icon: Layers,
    label: "Deriv Multipliers",
  },
   {
    href: "/deriv-trader", // Link direto para a V1
    icon: CandlestickChart,
    label: "Deriv Trader V1",
  },
  {
    href: "/deriv-trader-digits",
    icon: Crosshair,
    label: "Deriv Digits",
  },
   {
    href: "/audit-log",
    icon: Archive,
    label: "Arquivo de Auditoria",
  },
  {
    href: "/chat-insights",
    icon: Sparkles,
    label: "Chat Claritas",
  },
  {
    href: "/status",
    icon: Activity,
    label: "Status do Sistema",
  },
  {
    href: "/profile",
    icon: User,
    label: "Perfil",
    hidden: true,
  },
   {
    href: "/settings",
    icon: Settings,
    label: "Configurações",
    hidden: true,
  },
  {
    href: "/help",
    icon: HelpCircle,
    label: "Ajuda",
  },
];

function MainNav() {
  const pathname = usePathname();
  const isTraderSectionActive = pathname.startsWith('/deriv-trader') || pathname.startsWith('/trader');
  
  return (
    <SidebarMenu>
      {navItems.filter(item => !item.hidden).map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            asChild
            isActive={pathname === item.href}
            className="justify-start"
          >
            <a href={item.href}>
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}

      <Collapsible>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
              <SidebarMenuButton
                className="w-full justify-start"
                isActive={pathname.startsWith('/deriv-trader-v2')}
              >
                <Wand2 className="w-5 h-5" />
                <span>Deriv Trader V2</span>
                <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", pathname.startsWith('/deriv-trader-v2') && "rotate-180")} />
              </SidebarMenuButton>
          </CollapsibleTrigger>
        </SidebarMenuItem>
        <CollapsibleContent asChild>
            <SidebarMenuSub>
                 <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="/deriv-trader-v2" isActive={pathname === '/deriv-trader-v2'}>
                        <Wand2 />
                        <span>Trader 2.5 (IA)</span>
                    </SidebarMenuSubButton>
                </SidebarMenuSubItem>
                 <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="/deriv-trader-v3" isActive={pathname === '/deriv-trader-v3'}>
                        <TestTube />
                        <span>Trader 3.0 (IA Lab)</span>
                    </SidebarMenuSubButton>
                </SidebarMenuSubItem>
                <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="/trader" isActive={pathname === '/trader'}>
                        <Layers />
                        <span>Plataformas Futuras</span>
                    </SidebarMenuSubButton>
                </SidebarMenuSubItem>
            </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenu>
  )
}

function MobileSidebar() {
    const { openMobile, setOpenMobile } = useSidebar();
    return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent
            side="left"
            className="w-[18rem] bg-background p-0 text-foreground [&>button]:hidden"
          >
            <SheetHeader className="p-4">
              <SheetTitle className="sr-only">Menu de Navegação</SheetTitle>
              <div className="flex items-center gap-2">
                <Logo className="w-8 h-8 text-primary" />
                <h1 className="text-xl font-bold font-headline text-primary">
                  Claritas
                </h1>
              </div>
            </SheetHeader>
            <MainNav />
          </SheetContent>
        </Sheet>
    )
}

function DesktopSidebar() {
    const { state, toggleSidebar } = useSidebar();
    return (
        <Sidebar>
            <SidebarHeader className="p-4">
              <div className="flex items-center gap-2">
                <Logo className="w-8 h-8 text-primary" />
                <h1 className="text-xl font-bold font-headline text-primary">
                  Claritas
                </h1>
              </div>
            </SidebarHeader>
            <SidebarContent>
              <MainNav />
            </SidebarContent>
             <SidebarFooter>
                <div className="text-xs text-muted-foreground text-center p-2 group-data-[collapsible=icon]:hidden">
                    Versão 5.5.0
                </div>
                <Button variant="ghost" onClick={toggleSidebar} className="w-full justify-start">
                    {state === 'expanded' ? <PanelLeftClose /> : <PanelRightClose />}
                    <span className="group-data-[collapsible=icon]:hidden">{state === 'expanded' ? 'Recolher' : 'Expandir'}</span>
                </Button>
            </SidebarFooter>
        </Sidebar>
    )
}

function SidebarContent({children}: {children: React.ReactNode}) {
  return (
    <div
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
      )}
    >
        {children}
    </div>
  )
}


export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  
  const pageTitle = navItems.find(item => item.href === pathname)?.label || 'Claritas Copilot';

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <SidebarProvider>
      {isMobile ? <MobileSidebar /> : <DesktopSidebar />}
      <SidebarInset>
        <header className="sticky top-0 z-10 flex items-center justify-between h-16 px-4 bg-background/80 backdrop-blur-sm border-b">
          <div className="flex items-center gap-4">
              <SidebarTrigger className="md:hidden" />
              <h2 className="text-lg font-semibold font-headline">
                {pageTitle}
              </h2>
          </div>
          <UserNav />
        </header>
        <main>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
