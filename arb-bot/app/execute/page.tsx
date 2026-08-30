import StepsBreakdown from "../../components/StepsBreakdown";

export default function ExecutePage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-display text-2xl font-bold text-ink">Execute Flash Loan</h2>
      </div>
      <StepsBreakdown />
    </div>
  );
}
