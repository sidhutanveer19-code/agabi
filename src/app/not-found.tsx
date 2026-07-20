import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Route-level 404. */
export default function NotFound() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background px-7 text-center">
      <div style={{ fontFamily: "var(--font-display)" }} className="text-3xl text-foreground">
        Page not found.
      </div>
      <p className="max-w-[42ch] text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Button asChild>
        <Link href="/">Back to Agabi</Link>
      </Button>
    </div>
  );
}
