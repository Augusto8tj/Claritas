// /src/features/financials/components/dashboard/upcoming-bills.tsx
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

// A função agora é pura e recebe as transações
function getBills(transactions: Transaction[]) {
  const bills = transactions.filter(t => t.category === "Contas" && t.type === "expense");

  // This is a simplified logic. A real app would have a dedicated 'bills' collection
  // with due dates and payment status.
  const today = new Date();
  
  return bills.map(bill => {
    const dueDate = new Date(bill.date);
    // Mocking status based on date for demonstration
    const status = dueDate < today ? "Paga" : "Próxima";
    return {
        recipient: bill.description,
        dueDate: bill.date,
        amount: bill.amount,
        status: status,
    }
  }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

export function UpcomingBills({ transactions }: { transactions: Transaction[] }) {
  const bills = getBills(transactions);

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
