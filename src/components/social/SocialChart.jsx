import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { METRICS, PLATFORMS, metricSeries } from '@/lib/social/domain';

export default function SocialChart({ metrics, provider, metric, range }) {
  const rows = metricSeries(metrics, provider, metric, range);
  // Each account + source definition + unit/period type has its own chart.
  const groups = rows.reduce((result, row) => {
    const key = JSON.stringify([row.account_id, row.definition, row.unit, row.period_type]);
    (result[key] ||= []).push(row);
    return result;
  }, {});
  return <section className="rounded-xl border bg-white p-5 space-y-3" aria-label="Evolução do engajamento">
    <h2 className="font-semibold">Evolução de {METRICS[metric]?.toLowerCase()}</h2>
    <p className="text-sm text-slate-500">{provider === 'all' ? 'Selecione uma plataforma para consultar a série. Métricas de origens diferentes não são somadas.' : `${PLATFORMS[provider]} · valores conforme a definição fornecida pela plataforma.`}</p>
    {!rows.length ? <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed text-sm text-slate-500">Integração não configurada</div>
      : Object.entries(groups).map(([key, data]) => <div key={key}>
        <p className="text-xs text-slate-500">Conta {data[0].account_id} · {data[0].definition} · {data[0].unit} · {data[0].period_type}</p>
        <ResponsiveContainer width="100%" height={240}><LineChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period"/><YAxis/><Tooltip/><Line type="linear" dataKey="value" name={METRICS[metric]} stroke="#d97706" connectNulls={false}/></LineChart></ResponsiveContainer>
      </div>)}
  </section>;
}
