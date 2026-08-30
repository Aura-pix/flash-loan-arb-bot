import ScannerFeed from "../../components/ScannerFeed";

export default function ScannerPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Scanner Feed</h2>
      </div>
      <ScannerFeed />
    </div>
  );
}
