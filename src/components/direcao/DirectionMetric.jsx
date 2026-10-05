// Card do Painel da Direção ciente de ESTADO, não de string já pronta.
//
// Antes o chamador tinha que transformar o estado à mão (`dashboardValue`) e,
// esquecendo, o card voltava a mentir — era a fragilidade apontada na
// auditoria. Agora o contrato é explícito e o componente é o único lugar que
// decide o que exibir:
//
//   carregado=false -> "Carregando…"  (nunca 0: zero ainda não é verdade)
//   falhou=true      -> "Indisponível" (falhou ≠ zero)
//   carregado=true   -> o valor, e aqui 0 é um número legítimo
//
// `value` continua aceito para não quebrar chamadores que já passam texto
// pronto, mas `carregado`/`falhou` passam a ser a via normal.
export default function DirectionMetric({ label, value, detail, icon: Icon, tone = 'text-foreground', carregado = true, falhou = false }) {
  const estado = falhou ? 'error' : carregado ? 'ready' : 'loading';
  const texto = estado === 'error' ? 'Indisponível' : estado === 'loading' ? 'Carregando…' : value;
  const cor = estado === 'error' ? 'text-destructive' : estado === 'loading' ? 'text-muted-foreground' : tone;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={`h-5 w-5 ${tone}`} />
      </div>
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${cor}`} aria-busy={estado === 'loading' || undefined}>{texto}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}