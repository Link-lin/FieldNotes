"use client";

import { useState } from "react";
import { isDate, isLocalDateTime, isTime } from "@/shared/time";

type Kind = "date" | "time" | "datetime-local";
const VALID: Record<Kind, (value: string) => boolean> = { date: isDate, time: isTime, "datetime-local": isLocalDateTime };

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  kind: Kind;
  value: string;
  onChange: (value: string) => void;
  /** Shown in the text field an invalid value needs, such as "YYYY-MM-DD". */
  format: string;
};

/**
 * I4: a date, time or date-and-time field for the import preview. It is the browser's picker while
 * the value is empty or valid. A value the picker can't show (an AI mistake such as "2027-02-30")
 * stays in a plain text field, so nothing is hidden or dropped; once it's fixed, the picker returns
 * when the field loses focus, never while typing.
 */
export function PickerInput({ kind, value, onChange, format, onBlur, ...rest }: Props) {
  const valid = value === "" || VALID[kind](value);
  const [typing, setTyping] = useState(!valid);
  const text = !valid || typing;
  return (
    <input
      {...rest}
      type={text ? "text" : kind}
      value={value}
      placeholder={text ? format : undefined}
      onChange={(e) => {
        if (text) setTyping(true);
        onChange(e.target.value);
      }}
      onBlur={(e) => {
        if (valid) setTyping(false);
        onBlur?.(e);
      }}
    />
  );
}
