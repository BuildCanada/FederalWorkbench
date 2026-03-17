import { SystemStatusNotice } from "@/components/system-status-notice";

export default function WorkbenchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SystemStatusNotice />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
