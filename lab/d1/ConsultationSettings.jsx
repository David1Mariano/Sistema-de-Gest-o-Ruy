import {useTheme} from '@/lib/theme/ThemeProvider';
export default function ConsultationSettings(){
 const {tema,setTema}=useTheme();
 return <section className="max-w-3xl space-y-5"><h1 className="text-2xl font-semibold">Configurações</h1><p>Consulta compartilhada. Login e permissões são validados pela central. Alterações de usuários, regras e parâmetros operacionais permanecem bloqueadas.</p><div className="rounded-xl border bg-card p-5 space-y-3"><h2 className="font-semibold">Aparência</h2><p>A preferência de aparência vale somente para este computador.</p><div className="flex gap-3">{[{value:'light',label:'Modo Claro'},{value:'dark',label:'Modo Escuro'}].map(option=><button className="rounded border p-3" key={option.value} aria-pressed={tema===option.value} onClick={()=>setTema(option.value)}>{option.label}</button>)}</div></div></section>;
}
