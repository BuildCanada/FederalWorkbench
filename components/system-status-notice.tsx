import { Alert, AlertDescription } from "@/components/ui/alert";

export function SystemStatusNotice() {
  const message = process.env.NEXT_PUBLIC_SYSTEM_STATUS_MESSAGE;

  if (!message) {
    return null;
  }

  return (
    <Alert className="sticky top-0 z-50 rounded-none border-x-0 border-t-0 bg-red-100/80 py-2 dark:bg-red-950/60">
      <AlertDescription className="text-center text-sm">
        <span className="font-medium">System Status:</span> {message}
      </AlertDescription>
    </Alert>
  );
}
