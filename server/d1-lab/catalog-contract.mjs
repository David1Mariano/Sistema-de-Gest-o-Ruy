// Contrato restrito de CADASTROS. Saldos, pagamentos e movimentos não entram.
export const catalogFields={
 ExpenseCategory:['name','group','status'],
 Supplier:['name','trade_name','document','contact_name','phone','whatsapp','email','category','payment_terms','pix_key','status','observation'],
 InventoryItem:['name','sku','category','unit','minimum_stock','preferred_supplier_id','preferred_supplier_name','location','status','observation'],
 SystemSettings:['tolerance_minutes','coverage_config','company_name'],
 Employee:['name','social_name','birth_date','cpf','rg','phone','whatsapp','address','neighborhood','city','state','emergency_contact','emergency_phone','photo_url','sector','function','unit','hire_type','status','admission_date','default_start_time','default_end_time','work_days','day_off','salary','vale_value','responsible','experience_start','experience_end','pix_key','bank','observations','uniforms_delivered'],
};
export const privateEmployeeFields=['cpf','rg','birth_date','phone','whatsapp','address','neighborhood','city','state','emergency_contact','emergency_phone','photo_url','salary','vale_value','pix_key','bank','observations'];
export function projectEmployee(value,role){
 return role==='admin'?value:Object.fromEntries(Object.entries(value).filter(([k])=>!privateEmployeeFields.includes(k)));
}
