const fields=s=>s.split(' ');
export const payrollFields={
 PayrollPolicy:fields('name employee_id basis basis_cents divisor_units hourly_cents overtime_bps deduct_absences status'),
 PayrollRun:fields('employee_id policy_id reference_start reference_end units absence_units overtime_minutes bonus_cents vale_ids consumption_ids status calculation'),
};
export const isPayroll=entity=>Object.hasOwn(payrollFields,entity);
