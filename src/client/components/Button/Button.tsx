import "./Button.css";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

export function Button({ children, className, ...props }: ButtonProps) {
  return (
    <button className={`button${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </button>
  );
}
