import { Spinner } from "@/components/ui/spinner";

/** Route-level loading UI. */
export default function Loading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <Spinner size={28} />
    </div>
  );
}
