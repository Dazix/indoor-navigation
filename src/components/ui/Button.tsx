import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dark';
type Size = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-md shadow-brand-600/20 hover:bg-brand-500 focus-visible:outline-brand-500',
  secondary:
    'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  ghost:
    'text-slate-500 hover:bg-slate-500/10 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
  danger: 'bg-red-600 text-white hover:bg-red-500 focus-visible:outline-red-500',
  success: 'bg-emerald-600 text-white shadow-md hover:bg-emerald-500 focus-visible:outline-emerald-500',
  dark: 'bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-8 gap-1.5 rounded-lg px-2.5 text-xs',
  md: 'min-h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'min-h-12 gap-2 rounded-2xl px-5 text-base',
  icon: 'size-10 rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
