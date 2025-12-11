import Link from "next/link";

export function WorkbenchHeader({ onClick }: { onClick?: () => void } = {}) {
  return (
    <Link
      className="flex flex-row items-center gap-3"
      href="/workbench"
      onClick={onClick}
    >
      <span className="cursor-pointer rounded-md px-2 font-semibold text-lg hover:bg-muted">
        🇨🇦 Workbench
      </span>
    </Link>
  );
}
