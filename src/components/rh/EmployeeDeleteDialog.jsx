import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  EMPLOYEE_DELETE_BLOCK_CODE, EMPLOYEE_DELETE_CONFIRM_WORD,
  checkEmployeeDependencies, confirmacaoExclusaoValida, employeeDependenciesMessage,
  podeConfirmarExclusao,
} from '@/lib/employeeDelete';
import { EMPLOYEE_STATUS } from '@/lib/rhUtils';

// Linhas seguras no modo escuro: só entram cores com regra `.dark` própria em
// src/index.css (bg-red-50, text-red-700, border-red-200, bg-amber-50,
// text-amber-900, border-amber-200, bg-red-600, hover:bg-red-700). Nada de
// `bg-white` nem de hover claro — foi exatamente esse o defeito que o teste de
// inventário de tema caça.
const avisoDependencia = 'rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900';
const avisoErro = 'rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700';

/**
 * Confirmação da EXCLUSÃO FÍSICA do colaborador.
 *
 * Três garantias moram aqui, e não na tela:
 *
 *  1. PRÉ-CHECK ao abrir. Se o colaborador já tem vínculo, o bloqueio aparece
 *     na hora e o campo "digite EXCLUIR" nem é renderizado — não adianta fazer a
 *     pessoa confirmar por extenso uma exclusão que já sabemos que vai ser
 *     recusada. (E o `verificando` segura o botão enquanto a resposta não vem:
 *     enquanto o estado é desconhecido, o botão fica travado.)
 *  2. DUPLO CLIQUE. `ocupado` é a trava: o botão desabilita, vira "Excluindo…"
 *     e o handler sai na segunda chamada. Uma só operação no ar.
 *  3. A escrita NÃO é feita aqui. O diálogo só chama `onConfirm`; quem apaga é
 *     `deleteEmployeeIfUnused`, com rechecagem final. Se o `onConfirm` lançar,
 *     o erro fica na tela e o cadastro continua na lista — nada de falso sucesso.
 *
 * O `AlertDialogAction` recebe `preventDefault()` de propósito: sem isso o Radix
 * fecha o diálogo no clique e o usuário nunca vê o erro de uma falha.
 */
export default function EmployeeDeleteDialog({ open, employee, onClose, onConfirm }) {
  const [confirmacao, setConfirmacao] = useState('');
  const [verificando, setVerificando] = useState(false);
  // `null` = ainda não sabemos. Só com o resultado em mãos a exclusão é liberada.
  const [vinculos, setVinculos] = useState(null);
  const [erroVerificacao, setErroVerificacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
useEffect(() => {
    if (!open || !employee?.id) return undefined;
    let vivo = true;
    setConfirmacao('');
    setVinculos(null);
    setErro('');
    setErroVerificacao('');
    setOcupado(false);
    setVerificando(true);
    checkEmployeeDependencies(employee.id, base44.entities)
      .then((check) => { if (vivo) setVinculos(check); })
      .catch((e) => { if (vivo) setErroVerificacao(e?.message || 'Não foi possível verificar os registros vinculados.'); })
      .finally(() => { if (vivo) setVerificando(false); });
    return () => { vivo = false; };
  }, [open, employee]);

  const bloqueado = vinculos?.blocked === true;
  const liberou = confirmacaoExclusaoValida(confirmacao);
  const podeConfirmar = podeConfirmarExclusao({
    ocupado, verificando, erroVerificacao, bloqueado, confirmacao,
  });

  const fechar = () => { if (ocupado) return; onClose?.(); };

  const confirmar = async (event) => {
    event?.preventDefault?.();
    if (!podeConfirmar) return; // trava do duplo clique + confirmação obrigatória
    setOcupado(true);
    setErro('');
    try {
      await onConfirm(employee);
    } catch (e) {
      // Bloqueio vindo da rechecagem final: é o caso honesto de "apareceu um
      // registro entre o pré-check e agora", e a tela volta a mostrar o aviso.
      if (e?.code === EMPLOYEE_DELETE_BLOCK_CODE) setVinculos({
        blocked: true, dependencies: e.dependencies || {}, total: e.total || 0, resumo: e.resumo || [],
      });
      setErro(e?.message || 'Não foi possível excluir o colaborador. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  };

  const status = EMPLOYEE_STATUS[employee?.status] || EMPLOYEE_STATUS.inativo;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) fechar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir definitivamente?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação excluirá definitivamente o cadastro deste colaborador e não poderá ser desfeita.
            Se houver qualquer registro vinculado, a exclusão será bloqueada.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {employee && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium text-foreground">{employee.name}</p>
            <p className="text-muted-foreground">
              {employee.function || 'Sem função'} · {employee.sector || 'Sem setor'} · {status.label}
            </p>
          </div>
        )}

        {verificando && (
          <p className="text-sm text-muted-foreground">Verificando registros vinculados...</p>
        )}

        {erroVerificacao && (
          <p role="alert" className={avisoErro}>
            {erroVerificacao} Feche e abra a confirmação de novo para tentar outra vez.
          </p>
        )}

        {bloqueado && (
          <p role="alert" className={avisoDependencia}>
            {employeeDependenciesMessage(vinculos)}
            <span className="mt-1 block">
              Use a opção <strong>Desligar</strong> para preservar o histórico.
            </span>
          </p>
        )}

        {erro && !bloqueado && <p role="alert" className={avisoErro}>{erro}</p>}

        {!bloqueado && !verificando && !erroVerificacao && (
          <div className="space-y-2">
            <Label htmlFor="employee-delete-confirm" className="text-xs">
              Digite {EMPLOYEE_DELETE_CONFIRM_WORD} para confirmar
            </Label>
            <Input
              id="employee-delete-confirm"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              placeholder={EMPLOYEE_DELETE_CONFIRM_WORD}
              autoComplete="off"
              disabled={ocupado}
            />
            {!liberou && confirmacao.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Ainda não confere: digite {EMPLOYEE_DELETE_CONFIRM_WORD} exatamente como está.
              </p>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
          {!bloqueado && !erroVerificacao && (
            <AlertDialogAction
              onClick={confirmar}
              disabled={!podeConfirmar}
              className="bg-red-600 hover:bg-red-700"
            >
              {ocupado ? 'Excluindo...' : 'Excluir definitivamente'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}