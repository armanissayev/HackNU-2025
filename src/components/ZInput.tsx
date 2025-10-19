import React from 'react';

interface ZInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export function ZInput({ label, helperText, error, className = '', ...props }: ZInputProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {label && (
        <label className="text-[#475B53]" style={{ fontSize: '14px' }}>
          {label}
        </label>
      )}
      <input
        className={`w-full h-12 px-4 bg-white border border-[#E9F2EF] rounded-xl outline-none transition-shadow duration-200 focus:shadow-[0_0_0_6px_rgba(238,255,109,0.35)] ${className}`}
        {...props}
      />
      {(helperText || error) && (
        <span className={`text-xs ${error ? 'text-red-500' : 'text-[#475B53]'}`}>
          {error || helperText}
        </span>
      )}
    </div>
  );
}
