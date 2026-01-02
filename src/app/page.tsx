// /src/app/page.tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AIInsightCard } from "@/features/financials/components/dashboard/ai-insight-card";
import { NetWorthChart } from "@/features/financials/components/dashboard/net-worth-chart";
import { MonthlyBalance } from "@/features/financials/components/dashboard/monthly-balance";
import { UpcomingBills } from "@/features/financials/components/dashboard/upcoming-bills";
import { MainGoal } from "@/features/financials/components/dashboard/main-goal";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getFinancialSummary } from "@/services/financial-data-service";
import { auth } from "@/lib/firebase";

export const revalidate = 0; // Force dynamic rendering

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

function ChartSkeleton() {
    return (
        <Card className="col-span-4">
            <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent className="pl-2">
                <Skeleton className="h-[350px] w-full" />
            </CardContent>
        </Card>
    )
}

function BalanceSkeleton() {
    return (
         <Card>
            <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                   <Skeleton className="h-4 w-full" />
                   <Skeleton className="h-2 w-full" />
                   <Skeleton className="h-4 w-full" />
                </div>
            </CardContent>
        </Card>
    )
}


export default async function DashboardPage() {
  // Fetch data directly in the server component page
  const userId = auth.currentUser?.uid;
  let summary = { income: 0, expenses: 0 };
  
  if (userId) {
      try {
        summary = await getFinancialSummary(userId);
      } catch (e) {
        console.error("Failed to fetch financial summary on server:", e);
        // Default to zero values on error
        summary = { income: 0, expenses: 0 };
      }
  }

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Painel
        </h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Suspense fallback={<Skeleton className="h-36 w-full" />}>
           <AIInsightCard />
        </Suspense>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Suspense fallback={<ChartSkeleton/>}>
            <NetWorthChart />
        </Suspense>
        <div className="col-span-4 lg:col-span-3 space-y-4">
          <Suspense fallback={<BalanceSkeleton />}>
            {/* Pass the fetched data as props */}
            <MonthlyBalance income={summary.income} expenses={summary.expenses} />
          </Suspense>
          <Suspense fallback={<MainGoalSkeleton />}>
            <MainGoal />
          </Suspense>
        </div>
      </div>
       <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <UpcomingBills />
       </Suspense>
    </div>
  );
}
