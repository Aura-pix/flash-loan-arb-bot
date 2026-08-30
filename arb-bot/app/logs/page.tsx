import LogsTable from "../../components/LogsTable";

export default function LogsPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Run History</h2>
      </div>
      <LogsTable />
    </div>
  );
}
