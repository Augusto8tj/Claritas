// /src/app/goals/page.tsx
"use client";

import { useEffect, useState } from "react";
import { GoalCard } from "@/components/goals/goal-card";
import { AddGoalDialog } from "@/components/goals/add-goal-dialog";
import { getGoals } from "@/app/actions/financial-data-actions";
import type { Goal } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { FirestorePermissionError, errorEmitter } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Target } from "lucide-react";
import Link from "next/link";

export default function GoalsPage() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    
    const fetchGoals = async () => {
      setLoading(true);
      try {
        const fetchedGoals = await getGoals(user.uid);
        setGoals(fetchedGoals);
      } catch (error) {
        console.error(error);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `users/${user.uid}/goals`,
          operation: 'list'
        }));
      }
      setLoading(false);
    };

    fetchGoals();
  }, [user]);

  const handleGoalAdded = (newGoal: Goal) => {
    setGoals((prevGoals) => [...prevGoals, newGoal]);
  };

  const handleGoalDeleted = (deletedGoalId: string) => {
    setGoals((prevGoals) => prevGoals.filter(goal => goal.id !== deletedGoalId));
  }

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Metas Financeiras
        </h1>
        <AddGoalDialog onGoalAdded={handleGoalAdded} />
      </div>
      <p className="text-muted-foreground">
        Acompanhe seu progresso e mantenha-se motivado para alcançar seus sonhos.
      </p>
      
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg h-64">
            <Target className="h-12 w-12 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Nenhuma meta encontrada</h3>
            <p className="mb-4">Comece a planejar seu futuro financeiro. Crie sua primeira meta agora.</p>
            <AddGoalDialog onGoalAdded={handleGoalAdded} >
                 <Button>Criar Nova Meta</Button>
            </AddGoalDialog>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onGoalDeleted={handleGoalDeleted} />
          ))}
        </div>
      )}
    </div>
  );
}


function CardSkeleton() {
    return (
        <div className="flex flex-col space-y-3">
            <Skeleton className="h-[160px] w-full rounded-lg" />
            <div className="space-y-2 p-2">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
                 <Skeleton className="h-10 w-full mt-4" />
            </div>
        </div>
    )
}
