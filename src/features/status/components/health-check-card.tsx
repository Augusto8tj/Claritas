// /src/features/status/components/health-check-card.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, AlertTriangle, Loader2, Settings, ShieldCheck, Activity } from "lucide-react";
import Link from "next/link";
import { useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { cn } from "@/lib/utils";

type CheckResult = {
  success: boolean;
  error?: string;
};

interface HealthCheckCardProps {
  serviceName: string;
  icon?: ReactNode;
  description: string;
  successMessage: string;
  failureMessage: string;
  configurePath: string;
  checkResult?: CheckResult; 
  isClientSide?: boolean; 
}

export function HealthCheckCard({
  serviceName,
  icon,
  description,
  successMessage,
  failureMessage,
  configurePath,
  checkResult,
  isClientSide = false,
}: HealthCheckCardProps) {
  
  const { isConnected, isConnecting, connectionError, activeToken } = useDerivApi();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [displayMessage, setDisplayMessage] = useState<string>("");

  useEffect(() => {
    if (isClientSide) {
      if (isConnecting) {
        setStatus("loading");
        setDisplayMessage("Handshake em curso...");
      } else if (isConnected) {
        setStatus("success");
        setDisplayMessage(successMessage);
      } else {
        setStatus("error");
        if (!activeToken) {
           setDisplayMessage("Token PAT não detectado no browser.");
        } else {
           setDisplayMessage(connectionError || failureMessage);
        }
      }
    } else {
      if (checkResult?.success) {
        setStatus("success");
        setDisplayMessage(successMessage);
      } else {
        setStatus("error");
        setDisplayMessage(checkResult?.error || failureMessage);
      }
    }
  }, [isClientSide, checkResult, isConnected, isConnecting, connectionError, activeToken, successMessage, failureMessage]);


  const StatusInfo = () => {
    switch (status) {
      case "loading":
        return (
          <div className="flex items-center gap-3 text-muted-foreground bg-muted/20 p-4 rounded-lg border border-dashed animate-pulse">
            <Loader2 className="h-6 w-6 animate-spin" />
            <div className="space-y-1">
                <p className="font-bold text-xs uppercase">Diagnóstico</p>
                <p className="text-[11px]">Verificando integridade do nó...</p>
            </div>
          </div>
        );
      case "success":
        return (
          <div className="flex items-center gap-3 text-green-600 bg-green-500/5 p-4 rounded-lg border border-green-500/20">
            <ShieldCheck className="h-6 w-6" />
            <div>
                <p className="font-bold text-xs uppercase">Status: OK</p>
                <p className="text-[11px] font-medium leading-tight">{displayMessage}</p>
            </div>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-3 text-destructive bg-destructive/5 p-4 rounded-lg border border-destructive/20">
            <XCircle className="h-6 w-6" />
             <div>
                <p className="font-bold text-xs uppercase">Status: CRÍTICO</p>
                <p className="text-[11px] font-medium leading-tight">{displayMessage}</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="group overflow-hidden transition-all hover:border-primary/50">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
            <div className="space-y-1">
                <CardTitle className="font-headline flex items-center gap-2 text-lg">
                    {icon}
                    {serviceName}
                </CardTitle>
                <CardDescription className="text-xs">{description}</CardDescription>
            </div>
            <Activity className={cn("h-4 w-4 opacity-20", status === 'success' && "text-green-500 opacity-100")} />
        </div>
      </CardHeader>
      <CardContent className="pb-4">
          <StatusInfo />
      </CardContent>
      {status === 'error' && (
        <CardFooter className="bg-muted/30 pt-4">
          <Button asChild variant="ghost" size="sm" className="w-full text-xs h-8">
            <Link href={configurePath}>
              <Settings className="mr-2 h-3 w-3" />
              RECONFIGURAR SERVIÇO
            </Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
