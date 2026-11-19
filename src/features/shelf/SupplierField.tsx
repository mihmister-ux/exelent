import { useState } from "react";

import { Field, Input, Select } from "@/components/ui/input";

/** Служебное значение пункта «новый поставщик» — с ним приходит текстовое поле. */
const NEW_VALUE = "__new__";

export interface SupplierFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Известные поставщики: 7 листов журнала плюс всё, что уже добавили руками. */
  options: string[];
}

/**
 * Поставщик выбирается из списка, но список не закрыт: новый пишут руками.
 * В Excel поставщик задавался листом — здесь это обычное поле.
 */
export function SupplierField({ value, onChange, options }: SupplierFieldProps) {
  const known = options.includes(value);
  const [isCustom, setCustom] = useState(value !== "" && !known);

  const selectValue = isCustom ? NEW_VALUE : value;

  return (
    <Field label="Поставщик">
      <Select
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === NEW_VALUE) {
            setCustom(true);
            onChange("");
            return;
          }
          setCustom(false);
          onChange(next);
        }}
      >
        <option value="">— выберите поставщика —</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={NEW_VALUE}>+ Новый поставщик…</option>
      </Select>

      {isCustom ? (
        <Input
          className="mt-2"
          value={value}
          placeholder="Название поставщика"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </Field>
  );
}
