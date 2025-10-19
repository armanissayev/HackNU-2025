import React from 'react';

interface ZCardProps {
  children: React.ReactNode;
  className?: string;
}

export function ZCard({ children, className = '' }: ZCardProps) {
  return (
    <div 
      className={`bg-white border border-[#E9F2EF] rounded-[20px] p-6 ${className}`}
      style={{ boxShadow: '0 10px 30px rgba(13, 46, 40, 0.08)' }}
    >
      {children}
    </div>
  );
}
