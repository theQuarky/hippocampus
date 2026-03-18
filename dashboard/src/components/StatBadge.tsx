type StatBadgeProps = {
  label: string;
  value: number | string;
  trend?: string;
};

export function StatBadge({ label, value, trend }: StatBadgeProps) {
  return (
    <div className="stat-card">
      <h3>{label}</h3>
      <p style={{ fontFamily: 'monospace' }}>
        {value}
        {trend && <span style={{ fontSize: '0.8rem', color: '#22c55e', marginLeft: '0.4rem' }}>{trend}</span>}
      </p>
    </div>
  );
}
