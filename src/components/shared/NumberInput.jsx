import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatDecimalBR, parseDecimalBR } from '@/lib/numberUtils';

export { formatDecimalBR, parseDecimalBR };

/**
 * Campo numérico que aceita vírgula decimal.
 *
 * Usa inputMode="decimal" com máscara por texto (e não type="number"), porque
 * type="number" rejeita a vírgula: era exatamente o que impedia o usuário de
 * lançar "25,50" e fazia o valor virar 0 silenciosamente.
 */
export default function NumberInput({
  value,
  onChange,
  placeholder = '0,00',
  fractionDigits = 3,
  allowNegative = false,
  className,
  id,
  disabled,
  ...rest
}) {
  const toText = (v) => (v === '' || v === null || v === undefined ? '' : String(v));
  const [text, setText] = useState(() => formatDecimalBR(value, fractionDigits));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatDecimalBR(value, fractionDigits));
  }, [value, focused, fractionDigits]);

  const handle = (e) => {
    const raw = e.target.value;
    if (!allowNegative && raw.includes('-')) return;
    setText(raw);
    onChange(parseDecimalBR(raw));
  };

  return (
    <Input
      id={id}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onFocus={() => {
        setFocused(true);
        setText(toText(value));
      }}
      onBlur={() => setFocused(false)}
      onChange={handle}
      {...rest}
    />
  );
}
