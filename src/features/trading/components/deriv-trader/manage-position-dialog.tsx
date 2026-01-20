'use client';

import { useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Operation } from '@/lib/types';
import { useDerivApiMultipliers } from '../../hooks/use-deriv-api-multipliers';

interface ManagePositionDialogProps {
  operation: Operation;
  children: React.ReactNode;
}

const formSchema = z.object({
  takeProfit: z.coerce.number().optional(),
  stopLoss: z.coerce.number().min(0.01, "Stop Loss deve ser maior que $0.01.").optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function ManagePositionDialog({ operation, children }: ManagePositionDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { updateContract } = useDerivApiMultipliers();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema.refine((data) => {
        if (data.stopLoss !== undefined) {
            return data.stopLoss < operation.stake;
        }
        return true;
    }, {
        message: "Stop Loss deve ser menor que o valor da aposta inicial.",
        path: ["stopLoss"],
    })),
    defaultValues: {
      takeProfit: operation.takeProfit,
      stopLoss: operation.stopLoss,
    },
  });

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setLoading(true);
    const result = await updateContract(operation.id, data.takeProfit, data.stopLoss);
    setLoading(false);

    if (result.success) {
      toast({
        title: "Posição Atualizada",
        description: `Os limites de risco para o contrato #${operation.id} foram ajustados.`,
      });
      setOpen(false);
    } else {
      toast({
        variant: "destructive",
        title: "Falha na Atualização",
        description: result.message || "Não foi possível atualizar a posição.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-headline">Gerenciar Posição #{operation.id}</DialogTitle>
          <DialogDescription>
            Ajuste os limites de Take Profit e Stop Loss para a sua posição aberta em {operation.asset}.
            A aposta inicial foi de ${operation.stake.toFixed(2)}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="takeProfit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Take Profit (Lucro Alvo em USD)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Ex: 5.00"
                      {...field}
                      value={field.value ?? ''}
                      onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stopLoss"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stop Loss (Perda Máxima em USD)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Ex: 2.50"
                      {...field}
                      value={field.value ?? ''}
                      onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="ghost">Cancelar</Button></DialogClose>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
