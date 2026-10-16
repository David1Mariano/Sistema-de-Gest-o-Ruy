import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import {guardFinancialBatches} from './financial-guards.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export default defineConfig({root,envDir:false,publicDir:path.join(root,'lab/d1/public'),plugins:[{name:'d1-financial-guard',enforce:'pre',transform(code,id){if(id===path.join(root,'src/pages/Financeiro.jsx').replaceAll('\\','/'))return guardFinancialBatches(code);}},{name:'d1-local-fonts',enforce:'pre',async transform(code,id){if(id===path.join(root,'src/index.css').replaceAll('\\','/'))return code.replace(/^@import url\([^\n]+\);/,await fs.readFile(path.join(root,'lab/d1/fonts.css'),'utf8'));}},react()],resolve:{alias:[
 {find:'@/api/base44Client',replacement:path.join(root,'lab/d1/client.mjs')},
 {find:'@/lib/stockService',replacement:path.join(root,'lab/d1/stock-service.mjs')},
 {find:'@/lib/employeeDelete',replacement:path.join(root,'lab/d1/employee-delete.mjs')},
 {find:'@/lib/dailyExpenses',replacement:path.join(root,'lab/d1/daily-expenses.mjs')},
 {find:'@/components/ui/dialog',replacement:path.join(root,'lab/d1/dialog.jsx')},
 {find:'@/components/rh/SectorForm',replacement:path.join(root,'lab/d1/SectorForm.jsx')},
 {find:'@/components/rh/EmployeeDeleteDialog',replacement:path.join(root,'lab/d1/EmployeeDeleteDialog.jsx')},
 {find:'@/components/rh/ValeForm',replacement:path.join(root,'lab/d1/ValeForm.jsx')},
 {find:'@/components/rh/ConsumptionForm',replacement:path.join(root,'lab/d1/ConsumptionForm.jsx')},
 {find:'@/pages/Vales',replacement:path.join(root,'lab/d1/Vales.jsx')},
 {find:'@/pages/Consumo',replacement:path.join(root,'lab/d1/Consumo.jsx')},
 {find:'@/components/Topbar',replacement:path.join(root,'lab/d1/Topbar.jsx')},
 {find:'@/lib/AuthContext',replacement:path.join(root,'lab/d1/auth.jsx')},
 {find:'@/lib/useCurrentUser',replacement:path.join(root,'lab/d1/current-user.mjs')},
 {find:/^\.\/useCurrentUser(?:\.js)?$/,replacement:path.join(root,'lab/d1/current-user.mjs')},
 {find:/^\.\/AuthContext(?:\.jsx)?$/,replacement:path.join(root,'lab/d1/auth.jsx')},
 {find:/^(?:@\/lib\/supabaseClient(?:\.js)?|\.\/supabaseClient(?:\.js)?)$/,replacement:path.join(root,'lab/d1/cloud-disabled.mjs')},
 {find:'@',replacement:path.join(root,'src')},
]},build:{outDir:'dist-d1',emptyOutDir:true,rollupOptions:{input:path.join(root,'lab/d1/index.html')}}});
