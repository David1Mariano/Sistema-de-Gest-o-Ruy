import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Minus, Plus, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { loadPaymentProof, PAYMENT_PROOF_DIAG } from '@/lib/paymentProof';
import {
  FIT, FIT_LABELS, attachmentKind, autoFitMode, buildImagePrintHtml, createPreviewSession,
  downloadName, formatBytes, formatPixels, imageStyle, isTallImage, zoomFromPinch,
  zoomFromWheel, zoomLabel, zoomStep,
} from '@/lib/attachmentViewer';

// Visualização genérica de comprovantes/anexos: é O único visualizador do
// sistema. Gastos Diários, Contas a Pagar, Vales, Ficha do Colaborador e
// Pagamentos usam este componente, então zoom, pan, download e impressão são
// iguais em todas as telas (mesmo visual, mesma ajuda, mesmos limites).
//
// Data URL NUNCA é aberta direto: sempre vira Blob -> URL.createObjectURL, e a
// `createPreviewSession` revoga a URL ao fechar/desmontar, ao trocar de arquivo
// e também quando o download termina com o modal já fechado. Nada aqui grava
// ou altera armazenamento: o arquivo chega por `loadPaymentProof` como sempre.
export default function AttachmentPreview({
  record = {},
  label = 'Ver comprovante',
  title,
  prefix,
  diagLabel = PAYMENT_PROOF_DIAG,
  sourceField,
  className = 'text-xs text-emerald-700 underline',
} = {}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [natural, setNatural] = useState(null);
  const [fitMode, setFitMode] = useState(FIT.CONTAIN);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const viewportRef = useRef(null);
  const pdfFrameRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const dragRef = useRef(null);
  const printFramesRef = useRef([]);

  const hasProof = Boolean(record?.proof_url || record?.storage_path);
  const kind = attachmentKind(preview?.type);
  const isImage = kind === 'image';

  const previewFailed = (message) => {
    if (sourceField) console.error(diagLabel, 'ERRO', { status: null, code: 'PREVIEW_FAILED', message });
    setError(message);
  };

  // ------------------------------------------------- carregamento do arquivo
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    // Uma sessão por abertura: é o único lugar que cria Object URL.
    const session = createPreviewSession();
    setPreview(null);
    setError('');
    setNatural(null);
    setFitMode(FIT.CONTAIN);
    setZoom(1);
    console.info(diagLabel, 'preview: carregando', {
      recordId: record?.id || null,
      tipo: record?.storage_path ? 'storage' : 'legacy',
      mimeType: record?.mime_type || null,
      storagePath: record?.storage_path || null,
    });
    loadPaymentProof(record, { signal: controller.signal, prefix, diagLabel }).then((blob) => {
      if (controller.signal.aborted) return;
      const adopted = session.adopt(blob);
      // null = o modal fechou durante o download; a URL foi revogada na hora.
      if (!adopted) return;
      console.info(diagLabel, 'preview: blob criado', { mimeType: adopted.type, bytes: blob.size });
      setPreview({
        url: adopted.url,
        type: adopted.type,
        bytes: blob.size,
        name: downloadName(record, adopted.type),
      });
    }).catch((err) => {
      if (controller.signal.aborted) return;
      console.error(diagLabel, 'ERRO', { message: err?.message || String(err), status: err?.status ?? null, code: err?.code ?? null });
      setError(err.message);
    });
    return () => {
      controller.abort();
      if (session.close()) console.info(diagLabel, 'preview: blob URL revogada');
    };
  }, [open, record?.proof_url, record?.storage_path]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------- medir a área visível
  useEffect(() => {
    if (!open || !isImage) return undefined;
    const element = viewportRef.current;
    if (!element) return undefined;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, isImage]);

  // Ctrl/Cmd + roda = zoom. Sem modifier a roda só rola normalmente. Precisa de
  // addEventListener com passive:false porque o onWheel do React é passivo e
  // não consegue chamar preventDefault (a página daria zoom junto).
  useEffect(() => {
    if (!open || !isImage) return undefined;
    const element = viewportRef.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => zoomFromWheel(event.deltaY, current));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [open, isImage]);

  // Iframes usados para imprimir vivem até fechar o modal (a janela de
  // impressão é bloqueante) e são removidos também ao desmontar.
  const removePrintFrames = useCallback(() => {
    printFramesRef.current.forEach((frame) => frame.remove());
    printFramesRef.current = [];
  }, []);
  useEffect(() => {
    if (!open) removePrintFrames();
  }, [open, removePrintFrames]);
  useEffect(() => removePrintFrames, [removePrintFrames]);

  // --------------------------------------------------------------- zoom/ajuste
  const applyFit = (mode) => { setFitMode(mode); setZoom(1); };

  const onImageLoad = (event) => {
    const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
    const element = viewportRef.current;
    if (element) setViewport({ width: element.clientWidth, height: element.clientHeight });
    // Bobina (comprovante de cartão) abre pela LARGURA: "caber inteiro" deixa a
    // fonte ilegível e já foi a reclamação real aqui.
    const mode = autoFitMode(size);
    setNatural(size);
    setFitMode(mode);
    setZoom(1);
    if (sourceField) {
      console.info(diagLabel, 'preview carregado', {
        mimeType: preview?.type,
        largura: size.width,
        altura: size.height,
        proporcao: size.width ? Number((size.height / size.width).toFixed(2)) : null,
        ajuste: mode,
      });
    }
  };

  const onViewerKeyDown = (event) => {
    if (!isImage) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((z) => zoomStep(z, 1)); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom((z) => zoomStep(z, -1)); }
    else if (event.key === '0') { event.preventDefault(); applyFit(autoFitMode(natural)); }
  };

  // Arrastar com o mouse move a imagem (no celular o scroll nativo já move) e
  // pinça com dois dedos aplica zoom.
  const onPointerDown = (event) => {
    if (!isImage) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      dragRef.current = null;
    } else if (event.pointerType === 'mouse') {
      const element = viewportRef.current;
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: element?.scrollLeft ?? 0,
        top: element?.scrollTop ?? 0,
      };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const element = viewportRef.current;
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      setZoom(zoomFromPinch(pinchRef.current.distance, Math.hypot(a.x - b.x, a.y - b.y), pinchRef.current.zoom));
      return;
    }
    if (!dragRef.current || !element) return;
    element.scrollLeft = dragRef.current.left - (event.clientX - dragRef.current.x);
    element.scrollTop = dragRef.current.top - (event.clientY - dragRef.current.y);
  };

  const onPointerEnd = (event) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  // ----------------------------------------------------------------- ações
  const downloadFile = () => {
    if (!preview?.url) return;
    // <a download> sem target: baixa sem abrir aba nova.
    const anchor = document.createElement('a');
    anchor.href = preview.url;
    anchor.download = preview.name || 'comprovante';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    console.info(diagLabel, 'download iniciado', { nome: anchor.download, bytes: preview.bytes ?? null });
  };

  const printFile = () => {
    if (!preview?.url) return;
    if (!isImage) {
      // PDF: manda o próprio leitor do navegador imprimir (o documento já está
      // carregado no iframe). Se o navegador bloquear, orientação clara.
      const frame = pdfFrameRef.current;
      try {
        if (!frame?.contentWindow) throw new Error('sem janela');
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        setError('Não foi possível imprimir o PDF por aqui. Use Baixar e imprima do leitor de PDF.');
      }
      return;
    }
    try {
      const html = buildImagePrintHtml({
        url: preview.url,
        title: preview.name,
        width: natural?.width,
        height: natural?.height,
      });
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(frame);
      printFramesRef.current.push(frame);
      const doc = frame.contentDocument;
      if (!doc) throw new Error('Sem documento de impressão.');
      doc.open();
      doc.write(html);
      doc.close();
      const send = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      };
      const image = doc.images?.[0];
      if (image && !image.complete) {
        image.onload = send;
        image.onerror = () => setError('A impressão não pôde ser iniciada. Use Baixar e imprima o arquivo.');
      } else {
        send();
      }
    } catch (err) {
      setError(err?.message || 'A impressão não pôde ser iniciada.');
    }
  };

  if (!hasProof) return null;
  const meta = [formatPixels(natural), formatBytes(preview?.bytes)].filter(Boolean).join(' · ');

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => { console.info(diagLabel, 'preview: clique', { recordId: record?.id || null, campoUtilizado: sourceField, tipo: record?.storage_path ? 'storage' : 'legacy' }); setPreview(null); setError(''); setOpen(true); }}
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-[92vh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
          onKeyDown={onViewerKeyDown}
        >
          <DialogHeader className="border-b border-slate-200 px-4 py-3 pr-12 text-left sm:px-5">
            <DialogTitle className="text-base">{title || record?.file_name || 'Comprovante'}</DialogTitle>
            {meta ? <p className="text-xs text-slate-500">{meta}</p> : null}
          </DialogHeader>

          {preview && !error ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2 sm:px-4">
            {isImage ? (
              <>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => zoomStep(z, -1))} aria-label="Diminuir zoom" title="Diminuir zoom (tecla −)">
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center text-xs font-medium tabular-nums text-slate-600">{zoomLabel(zoom)}</span>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => zoomStep(z, 1))} aria-label="Aumentar zoom" title="Aumentar zoom (tecla +)">
                  <Plus className="h-4 w-4" />
                </Button>
                <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
                {[FIT.CONTAIN, FIT.WIDTH, FIT.ACTUAL].map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={fitMode === mode ? 'secondary' : 'ghost'}
                    onClick={() => applyFit(mode)}
                    title={mode === FIT.WIDTH ? 'Preencher a largura (ideal para bobina)' : undefined}
                  >
                    {FIT_LABELS[mode]}
                  </Button>
                ))}
              </>
            ) : (
              <span className="text-xs text-slate-500">PDF: use a barra do leitor do navegador para zoom e rolagem.</span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" onClick={downloadFile} className="gap-1.5">
                <Download className="h-4 w-4" />
                Baixar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={printFile} className="gap-1.5">
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>
            </span>
          </div>
          ) : null}

          {error ? (
            <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-5">{error}</p>
          ) : null}
          {!preview && !error ? (
            <p role="status" className="px-4 py-3 text-sm text-slate-500">Carregando comprovante...</p>
          ) : null}

          {open && preview && !error ? (isImage ? (
            <div
              ref={viewportRef}
              className="min-h-0 flex-1 cursor-grab overflow-auto bg-slate-100 p-3 active:cursor-grabbing"
              style={{ touchAction: 'pan-x pan-y', scrollbarGutter: 'stable' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onDoubleClick={() => applyFit(zoom > 1 ? autoFitMode(natural) : FIT.ACTUAL)}
            >
              <img
                alt="Comprovante"
                src={preview.url}
                draggable={false}
                onLoad={onImageLoad}
                onError={() => previewFailed('O navegador não conseguiu decodificar a imagem do comprovante.')}
                style={imageStyle({ mode: fitMode, zoom, natural, viewport })}
                className="mx-auto block select-none bg-white shadow-sm"
              />
            </div>
          ) : kind === 'pdf' ? (
            <iframe
              ref={pdfFrameRef}
              title="Comprovante PDF"
              src={preview.url}
              className="min-h-0 w-full flex-1 border-0 bg-white"
              onLoad={() => sourceField && console.info(diagLabel, 'preview carregado', { mimeType: preview.type })}
              onError={() => previewFailed('O navegador não conseguiu exibir o PDF.')}
            />
          ) : (
            <p className="px-4 py-3 text-sm text-slate-600">
              Este arquivo não pode ser exibido aqui. Use Baixar para abrir no aplicativo adequado.
            </p>
          )) : null}

          {isImage ? (
            <p className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 sm:px-5">
              Ctrl + roda do mouse: zoom · arraste para mover · pinça com dois dedos no celular
              {isTallImage(natural) ? ' · bobina ajustada pela largura para a fonte ficar legível' : ''}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}



