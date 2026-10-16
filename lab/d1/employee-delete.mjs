export * from '../../src/lib/employeeDelete.js';
import {request} from './client.mjs';
export async function checkEmployeeDependencies(id){return request('/employees/'+id+'/dependencies');}
export async function deleteEmployeeIfUnused({entities,employee}){
 if(!employee?.id||!employee._version)throw Error('Recarregue o colaborador antes de excluir.');
 return entities.Employee.delete(employee.id,{baseVersion:employee._version,confirmation:'EXCLUIR'});
}
