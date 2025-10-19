import React from 'react';

interface ZButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent';
  children: React.ReactNode;
}

export function ZButton({ variant = 'primary', children, className = '', ...props }: ZButtonProps) {
  const baseStyles = 'px-4 py-3 rounded-xl transition-all duration-200';
  
  const variantStyles = {
    primary: 'bg-[#1A5C50] text-white hover:opacity-90',
    secondary: 'bg-white text-[#1A5C50] border border-[#2D9A86] hover:shadow-[0_10px_30px_rgba(13,46,40,0.08)]',
    accent: 'bg-[#EEFF6D] text-[#111] hover:shadow-[0_0_0_6px_rgba(238,255,109,0.35)]'
  };
  
  return (
    <button 
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
