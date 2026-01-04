// /src/components/analysis/transactions-table.tsx
"use client";

import * as React from "react";
import { getTransactions } from "@/services/financial-data-service";
import type { Transaction } from "@/lib/types";
import { useAuth } from "@/features/auth/hooks/use-auth";
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
import {
  Utensils,
  Home,
  Car,
  Ticket,
  ShoppingCart,
  MoreHorizontal,
  ArrowDown,
  ArrowUp,
  Loader2,
} from "lucide-react";

const categoryIcons: { [key: string]: React.ReactNode } = {
  "Alimentação": <Utensils className="h-4 w-4 text-muted-foreground" />,
  "Compras": <ShoppingCart className="h-4 w-4 text-muted-foreground" />,
  "Moradia": <Home className="h-4 w-4 text-muted-foreground" />,
  "Transporte": <Car className="h-4 w-4 text-muted-foreground" />,
  "Lazer": <Ticket className="h-4 w-4 text-muted-foreground" />,
  "Outros": <MoreHorizontal className="h-4 w-4 text-muted-foreground" />,
};

export function TransactionsTable() {
  const { user } = useAuth();
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      setLoading(true);
      const data = await getTransactions(user.uid);
      data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTransactions(data);
      setLoading(false);
    };
    fetchData();
  }, [user]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Transações Recentes</CardTitle>
        <CardDescription>
          Uma lista de suas transações recentes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : transactions.length > 0 ? (
              transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.description}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {categoryIcons[t.category] || categoryIcons["Outros"]}
                      {t.category}
                    </div>
                  </TableCell>
                  <TableCell>
                    {new Date(t.date).toLocaleDateString("pt-BR", {
                      timeZone: "UTC",
                    })}
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    <div className="flex items-center justify-end gap-1">
                      {t.type === 'income' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                       R${t.amount.toFixed(2).replace(".", ",")}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
                <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Nenhuma transação encontrada.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
