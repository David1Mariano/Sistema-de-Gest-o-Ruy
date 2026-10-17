// Proposal for server/local/rh-contract.mjs; not wired into any runtime.
export const RH_ENTITIES = new Set(['EmployeeDocument','EmployeePayment','Evaluation','Warning','Vale','Absence','TimeRecord','Schedule','StandardSchedule']);
const common='id created_date updated_date updated_at employee_id employee_name sector unit observation responsible_user';
const fields={
  EmployeeDocument:'name category date file_url uploaded_by',
  EmployeePayment:'payment_type reference_start reference_end work_date days_quantity daily_rate gross_amount discount_amount net_amount payment_date payment_method proof_url storage_path file_name mime_type file_size status function',
  Evaluation:'date period score notes evaluator',
  Warning:'date category description status attachment_url',
  Vale:'date amount type motive payment_method authorized_by status proof_url storage_path file_name mime_type file_size',
  Absence:'date type expected_time actual_time minutes reason status schedule_id',
  TimeRecord:'date entry_time lunch_start lunch_end exit_time expected_start expected_end late_minutes early_exit_minutes worked_minutes expected_minutes break_minutes origin status schedule_id',
  Schedule:'date function start_time end_time break_start break_end day_type status substitute_id substitute_name absence_marked',
  StandardSchedule:'weekday start_time end_time break_start break_end day_type',
};
const numbers=new Set('days_quantity daily_rate gross_amount discount_amount net_amount file_size score amount minutes late_minutes early_exit_minutes worked_minutes expected_minutes break_minutes weekday'.split(' '));
const dates=new Set('date payment_date reference_start reference_end work_date'.split(' '));
const times=new Set('expected_time actual_time entry_time lunch_start lunch_end exit_time expected_start expected_end start_time end_time break_start break_end'.split(' '));
const files=new Set(['file_url','proof_url','storage_path','attachment_url']);
const fail=(status,message)=>Object.assign(Error(message),{status});
export function authorizeRh(user,entity) {
  if(!RH_ENTITIES.has(entity))throw fail(400,'Unknown RH entity.');
  if(!user?.active)throw fail(401,'Authentication required.');
  if(user.role!=='admin')throw fail(403,'RH restricted to local administrator.');
}
export async function guardRh(client,entity,id,operation,data,confirmation) {
  if(!RH_ENTITIES.has(entity))return;
  const existing=(await client.query('SELECT data FROM local_records WHERE entity=$1 AND id=$2',[entity,id])).rows[0]?.data;
  if(operation==='delete') {
    if(confirmation!=='EXCLUIR')throw fail(400,'Confirm EXCLUIR.');
    if(entity==='Schedule' && (await client.query("SELECT 1 FROM local_records WHERE entity IN ('Absence','TimeRecord') AND data->>'schedule_id'=$1",[id])).rowCount)throw fail(409,'Schedule has historical dependencies.');
    return;
  }
  const allowed=new Set((common+' '+fields[entity]).split(' '));
  for(const [key,value] of Object.entries(data)) {
    if(!allowed.has(key))throw fail(400,'Unsupported RH field: '+key);
    if(value==null)continue;
    if(numbers.has(key)) {
      if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw fail(400,'Invalid numeric field: '+key);
    }else if(key==='absence_marked') {
      if(typeof value!=='boolean')throw fail(400,'Invalid absence flag.');
    }else if(typeof value!=='string'||value.length>10000)throw fail(400,'Invalid text field: '+key);
    if(dates.has(key)&&value && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(new Date(value).getTime())||new Date(value).toISOString().slice(0,10)!==value))throw fail(400,'Invalid RH date.');
    if(times.has(key)&&value&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw fail(400,'Invalid RH time.');
    // Existing remote references are preserved, never fetched. New binary storage needs its own contract.
    if(files.has(key)&&value&&value!==existing?.[key])throw fail(501,'New attachment reference requires validated central attachment service.');
  }
  if(!data.employee_id)throw fail(400,'employee_id required.');
  if(existing?.employee_id&&data.employee_id!==existing.employee_id)throw fail(409,'Employee relationship cannot be reassigned silently.');
  for(const employeeId of [data.employee_id,data.substitute_id].filter(Boolean)) {
    if(!(await client.query("SELECT 1 FROM local_records WHERE entity='Employee' AND id=$1 AND NOT deleted",[employeeId])).rowCount)throw fail(409,'Employee unavailable.');
  }
  if(data.schedule_id) {
    const schedule=(await client.query("SELECT data FROM local_records WHERE entity='Schedule' AND id=$1 AND NOT deleted",[data.schedule_id])).rows[0]?.data;
    if(!schedule||schedule.employee_id!==data.employee_id||(data.date&&schedule.date!==data.date))throw fail(409,'Schedule relationship mismatch.');
  }
  if(entity==='StandardSchedule') {
    if(!Number.isInteger(data.weekday)||data.weekday>6)throw fail(400,'weekday must be 0..6.');
  } else if(!data[entity==='EmployeePayment'?'payment_date':'date'])throw fail(400,'RH date required.');
  if(entity==='EmployeeDocument'&&!data.name?.trim())throw fail(400,'Document name required.');
  const statuses={EmployeePayment:['pendente','pago','cancelado'],Vale:['pendente','descontado','cancelado'],Absence:['ativo','cancelado'],Warning:['pendente','tratada','cancelada'],Schedule:['ativo','cancelado'],TimeRecord:['folga','ausente','incompleto','intervalo','atrasado','finalizado','presente']};
  if(statuses[entity]&&data.status&&!statuses[entity].includes(data.status))throw fail(400,'Invalid RH status.');
  if(['Schedule','StandardSchedule'].includes(entity)&&!['trabalho','folga','ferias','afastamento','compensacao'].includes(data.day_type))throw fail(400,'Invalid day type.');
  if(['Schedule','StandardSchedule'].includes(entity)&&data.start_time&&data.end_time&&data.end_time<=data.start_time)throw fail(400,'End time must follow start time.');
  if(entity==='EmployeePayment') {
    for(const key of ['gross_amount','discount_amount','net_amount'])if(typeof data[key]!=='number'||!Number.isSafeInteger(Math.round(data[key]*100))||Math.abs(data[key]*100-Math.round(data[key]*100))>1e-7)throw fail(400,'Payment requires amounts in cents.');
    if(Math.round(data.gross_amount*100)-Math.round(data.discount_amount*100)!==Math.round(data.net_amount*100))throw fail(400,'Payment total mismatch.');
  }
  if(entity==='Vale'&&(typeof data.amount!=='number'||data.amount<=0||!Number.isSafeInteger(Math.round(data.amount*100))||Math.abs(data.amount*100-Math.round(data.amount*100))>1e-7))throw fail(400,'Invalid vale amount.');
  if(['TimeRecord','StandardSchedule'].includes(entity)) {
    const key=entity==='TimeRecord'?'date':'weekday';
    if((await client.query('SELECT 1 FROM local_records WHERE entity=$1 AND id<>$2 AND NOT deleted AND data->>\'employee_id\'=$3 AND data->>$4=$5',[entity,id,data.employee_id,key,String(data[key])])).rowCount)throw fail(409,'Duplicate employee period.');
  }
  if(entity==='Schedule'&&data.status!=='cancelado') {
    const rows=(await client.query("SELECT data FROM local_records WHERE entity='Schedule' AND id<>$1 AND NOT deleted AND data->>'employee_id'=$2 AND data->>'date'=$3",[id,data.employee_id,data.date])).rows;
    for(const {data:other} of rows.filter(row=>row.data.status!=='cancelado')) {
      if(data.day_type==='trabalho'&&['ferias','folga'].includes(other.day_type)||['ferias','folga'].includes(data.day_type)&&other.day_type==='trabalho')throw fail(409,'Day off/vacation/work schedule conflict.');
      if(data.day_type==='trabalho'&&other.day_type==='trabalho'&&data.start_time<other.end_time&&other.start_time<data.end_time)throw fail(409,'Overlapping work schedule.');
    }
  }
}
