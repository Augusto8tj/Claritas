// /src/components/goals/goal-card.tsx
"use client";

import Image from "next/image";
import * as React from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GoalProjectionDialog } from "./goal-projection-dialog";
import type { Goal } from "@/lib/types";
import { Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { deleteGoal } from "@/services/financial-data-service";
import { useAuth } from "@/features/auth/hooks/use-auth";

interface GoalCardProps {
  goal: Goal;
  onGoalDeleted: (goalId: string) => void;
}

export function GoalCard({ goal, onGoalDeleted }: GoalCardProps) {
  const { user } = useAuth();
  const progress = (goal.currentAmount / goal.targetAmount) * 100;
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "Erro", description: "Utilizador não autenticado." });
      return;
    }
    setIsDeleting(true);
    try {
        await deleteGoal(user.uid, goal.id);
        setIsDeleting(false);
        toast({
            title: "Meta Deletada",
            description: `A meta "${goal.name}" foi removida.`,
        });
        onGoalDeleted(goal.id);
    } catch (error: any) {
        setIsDeleting(false);
        toast({
            variant: "destructive",
            title: "Erro ao Deletar",
            description: error.message || "Não foi possível deletar a meta.",
        });
    }
  };


  return (
    <Card className="flex flex-col">
      <CardHeader className="p-0 relative">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 z-10 h-8 w-8"
              aria-label="Deletar meta"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. Isso irá deletar permanentemente a meta
                "{goal.name}".
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Deletar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="relative h-40 w-full">
          <Image
            src={goal.imageUrl}
            alt={goal.name}
            fill={true}
            style={{objectFit: 'cover'}}
            className="rounded-t-lg"
            data-ai-hint={goal.imageHint}
          />
        </div>
        <div className="p-6 pb-2">
            <CardTitle className="font-headline text-xl">{goal.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="space-y-2">
          <Progress value={progress} />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>R${goal.currentAmount.toLocaleString('pt-BR')}</span>
            <span>R${goal.targetAmount.toLocaleString('pt-BR')}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <GoalProjectionDialog goal={goal} />
      </CardFooter>
    </Card>
  );
}
