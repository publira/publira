import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@publira/ui-components/card";
import {
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from "@publira/ui-components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-6 py-10">
      <Card>
        <CardHeader className="grid gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>

          <div className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>

          <div className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <SkeletonText lines={3} />
          </div>

          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-4 w-32" />
          </div>

          <div className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <SkeletonText lines={4} />
          </div>
        </CardContent>

        <CardFooter className="justify-end gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </CardFooter>
      </Card>

      <SkeletonCard />
    </main>
  );
}
