const fields=text=>text.split(' ');
export const attendanceFields={
 Schedule:fields('employee_id employee_name date sector function unit start_time end_time break_start break_end day_type status observation absence_marked'),
 StandardSchedule:fields('employee_id employee_name weekday start_time end_time break_start break_end day_type status'),
 TimeRecord:fields('employee_id employee_name date sector unit schedule_id entry_time lunch_start lunch_end exit_time expected_start expected_end late_minutes early_exit_minutes worked_minutes expected_minutes break_minutes status observation responsible_user origin adjustment_reason'),
 Absence:fields('employee_id employee_name sector date type expected_time actual_time minutes reason observation status responsible_user schedule_id attachment_url'),
 Warning:fields('employee_id employee_name sector date category description status observation responsible_user attachment_url'),
};
export const isAttendance=entity=>Object.hasOwn(attendanceFields,entity);
