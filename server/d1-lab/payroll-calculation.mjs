// Explicit configured arithmetic only: no employment classification, statutory
// discounts, assumed month divisor or automatic bank/payment instruction.
const integer=(value,max=1e9)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const rounded=(n,d)=>Number((n+d/2n)/d);
export function calculatePayroll(policy,input,deductions=[]){
 if(!['monthly','daily'].includes(policy.basis)||!integer(policy.basis_cents)||!integer(policy.divisor_units,366)||policy.divisor_units<1||!integer(policy.hourly_cents)||!integer(policy.overtime_bps,40000)||typeof policy.deduct_absences!=='boolean')throw Error('PAYROLL_POLICY_REQUIRED');
 for(const key of ['units','absence_units','overtime_minutes','bonus_cents'])if(!integer(input[key],key==='overtime_minutes'?527040:key==='bonus_cents'?1e9:366))throw Error('PAYROLL_INPUT_INVALID');
 if(input.absence_units>input.units||input.absence_units&&!policy.deduct_absences||policy.basis==='daily'&&input.absence_units)throw Error('PAYROLL_ABSENCE_POLICY_REFUSED');
 if(input.overtime_minutes&&(!policy.hourly_cents||!policy.overtime_bps))throw Error('PAYROLL_OVERTIME_POLICY_REQUIRED');
 if(!Array.isArray(deductions)||deductions.some(n=>!integer(n)))throw Error('PAYROLL_DEDUCTIONS_INVALID');
 const divisor=BigInt(policy.basis==='monthly'?policy.divisor_units:1),base=BigInt(policy.basis_cents);
 const basisCents=rounded(base*BigInt(input.units),divisor),absenceCents=rounded(base*BigInt(input.absence_units),divisor);
 const overtimeCents=rounded(BigInt(policy.hourly_cents)*BigInt(input.overtime_minutes)*BigInt(policy.overtime_bps),600000n);
 const rhCents=deductions.reduce((a,b)=>a+b,0),grossCents=basisCents+overtimeCents+input.bonus_cents,discountCents=absenceCents+rhCents,netCents=grossCents-discountCents;
 if(![basisCents,absenceCents,overtimeCents,rhCents,grossCents,discountCents,netCents].every(Number.isSafeInteger)||grossCents>1e9||netCents<0)throw Error('PAYROLL_TOTAL_REFUSED');
 return {basisCents,absenceCents,overtimeCents,bonusCents:input.bonus_cents,rhCents,grossCents,discountCents,netCents,rounding:'half-up-per-line',externalPayment:false};
}
