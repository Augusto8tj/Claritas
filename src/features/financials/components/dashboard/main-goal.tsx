// src/features/financials/components/dashboard/main-goal.tsx
"use client";

import { useAuth } from "@/features/auth/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { getGoals } from "@/app/actions/financial-data-actions";
import type { Goal } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { GoalProgressChart } from "./goal-progress-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { FirestorePermissionError, errorEmitter } from "@/firebase";

function MainGoalSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent className="flex items-center justify-center p-6">
        <Skeleton className="h-36 w-36 rounded-full" />
      </CardContent>
    </Card>
  )
}

export function MainGoal() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
        const userGoals = await getGoals(user.uid);
        setGoals(userGoals);
    } catch (error) {
        console.error(error); // Log the raw error
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `users/${user.uid}/goals`,
          operation: 'list'
        }));
        setGoals([]); // Reset goals on error
    } finally {
        setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);


  if (loading) {
    return <MainGoalSkeleton />;
  }
  
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Metas</CardTitle>
          <CardDescription>Faça login para ver suas metas.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!goals || goals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Metas</CardTitle>
          <CardDescription>Nenhuma meta encontrada.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Vá para a página de Metas para adicionar sua primeira.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Acompanhamento de Metas</CardTitle>
        <CardDescription>
          Veja o progresso de suas metas financeiras.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center p-6">
        <Carousel className="w-full max-w-xs" opts={{ loop: true }}>
          <CarouselContent>
            {goals.map((goal) => (
              <CarouselItem key={goal.id}>
                <div className="p-1 text-center">
                  <h3 className="font-semibold text-lg">{goal.name}</h3>
                  <GoalProgressChart goal={goal} />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </CardContent>
    </Card>
  );
}
