export const countMonthlyWarnings = (warnings, month) => warnings.filter(w => w.date?.startsWith(month)).length;

export function buildRHMetrics({ employees, schedules, absences, vales, warnings }, today) {
  const linked = row => employees.some(e => e.id === row.employee_id);
  const pendingVales = vales.filter(v => v.status === 'pendente' && linked(v));
  return {
    total: employees.length,
    active: employees.filter(e => ['ativo', 'em_experiencia'].includes(e.status)).length,
    away: employees.filter(e => e.status === 'afastado').length,
    workingToday: schedules.filter(s => s.day_type === 'trabalho' && s.status === 'ativo' && linked(s)).length,
    offToday: schedules.filter(s => s.day_type === 'folga' && linked(s)).length,
    absToday: absences.filter(a => a.date === today && ['falta', 'nao_justificada'].includes(a.type) && a.status === 'ativo' && linked(a)).length,
    lateToday: absences.filter(a => a.date === today && a.type === 'atraso' && a.status === 'ativo' && linked(a)).length,
    valesPending: pendingVales.length,
    valesPendingAmount: pendingVales.reduce((sum, v) => sum + Number(v.amount || 0), 0),
    warnMonth: countMonthlyWarnings(warnings.filter(linked), today.slice(0, 7)),
    newMonth: employees.filter(e => e.created_date?.startsWith(today.slice(0, 7))).length,
  };
}
