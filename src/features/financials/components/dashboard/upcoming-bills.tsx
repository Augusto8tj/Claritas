// /src/features/financials/components/dashboard/upcoming-bills.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Transaction } from "@/lib/types";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { getTransactions } from "@/services/financial-data-service";
import { useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { errorEmitter, FirestorePermissionError } from "@/firebase";

function getBills(transactions: Transaction[]) {
  const bills = transactions.filter(t => t.category === "Contas" && t.type === "expense");
  const today = new Date();
  
  return bills.map(bill => {
    const dueDate = new Date(bill.date);
    const status = dueDate < today ? "Paga" : "Próxima";
    return {
        recipient: bill.description,
        dueDate: bill.date,
        amount: bill.amount,
        status: status,
    }
  }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

export function UpcomingBills() {
  const { user } = useAuth();
  const [bills, setBills] = useState<ReturnType<typeof getBills>>([]);
  const [loading, setLoading] = useState(true);
  
  const fetchBills = useCallback(async () => {
    if (!user) {
        setLoading(false);
        setBills([]);
        return;
    }
    setLoading(true);
    try {
        const transactions = await getTransactions(user.uid);
        const processedBills = getBills(transactions);
        setBills(processedBills);
    } catch(error) {
        console.error("Failed to fetch transactions for bills:", error);
        setBills([]); // Garante estado zerado em caso de erro
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `users/${user.uid}/transactions`,
          operation: 'list'
        }));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Paga':
        return <Badge variant="secondary">Paga</Badge>;
      case 'Próxima':
        return <Badge variant="outline" className="border-accent/50 text-accent">Próxima</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Contas Recentes</CardTitle>
        <CardDescription>
          Suas contas pagas e próximas para este ciclo. (Use a categoria &quot;Contas&quot; ao adicionar despesas).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Beneficiário</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Data de Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.length > 0 ? bills.map((bill, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{bill.recipient}</TableCell>
                 <TableCell className="text-center">{getStatusBadge(bill.status)}</TableCell>
                <TableCell className="text-center">{new Date(bill.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</TableCell>
                <TableCell className="text-right">R${bill.amount.toFixed(2).replace('.', ',')}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                  Nenhuma conta registrada. Adicione despesas na categoria &quot;Contas&quot; para vê-las aqui.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
