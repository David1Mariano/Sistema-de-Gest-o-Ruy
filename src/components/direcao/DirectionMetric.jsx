export default function DirectionMetric({ label, value, detail, icon: Icon, tone = 'text-foreground' }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={`h-5 w-5 ${tone}`} />
      </div>
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}