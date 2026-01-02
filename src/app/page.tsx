// /src/app/page.tsx
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { AIInsightCard } from "@/features/financials/components/dashboard/ai-insight-card";
import { NetWorthChart } from "@/features/financials/components/dashboard/net-worth-chart";
import { MonthlyBalance } from "@/features/financials/components/dashboard/monthly-balance";
import { UpcomingBills } from "@/features/financials/components/dashboard/upcoming-bills";
import { MainGoal } from "@/features/financials/components/dashboard/main-goal";
import { Skeleton } from "@/components/ui/skeleton";
import { FirstTransactionGuide } from "@/features/financials/components/dashboard/first-transaction-guide";

export default function DashboardPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Painel
        </h1>
      </div>
      
      <Suspense fallback={null}>
         <FirstTransactionGuide />
      </Suspense>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Suspense fallback={<Skeleton className="h-36 w-full col-span-4" />}>
           <AIInsightCard />
        </Suspense>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Suspense fallback={
            <Card className="col-span-4">
                <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent className="pl-2">
                    <Skeleton className="h-[350px] w-full" />
                </CardContent>
            </Card>
        }>
            <NetWorthChart />
        </Suspense>
        <div className="col-span-4 lg:col-span-3 space-y-4">
          <Suspense fallback={
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
          }>
            <MonthlyBalance />
          </Suspense>
          <Suspense fallback={
             <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent className="flex items-center justify-center p-6">
                    <Skeleton className="h-36 w-36 rounded-full" />
                </CardContent>
            </Card>
          }>
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
