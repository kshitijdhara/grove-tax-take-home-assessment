import "./TextInput.css";
import type { InputHTMLAttributes } from "react";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function TextInput({ className, ...props }: TextInputProps) {
  return (
    <input
      type="text"
      className={`text-input${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}
