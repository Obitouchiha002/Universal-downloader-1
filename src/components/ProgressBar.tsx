import React from 'react';

interface ProgressBarProps {
  progress: number; // 0 to 100
  label?: string;
}

export function ProgressBar({ progress, label }: ProgressBarProps) {
  return (
    <div className="w-full mt-2">
      {label && (
        <div className="flex justify-between items-end mb-2">
          <div className="text-xs font-bold text-[#5A5A40]/80">{label}</div>
          <div className="text-sm font-serif text-[#5A5A40]">{Math.round(progress)}%</div>
        </div>
      )}
      <div className="w-full h-2 bg-[#5A5A40]/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#5A5A40] rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        ></div>
      </div>
    </div>
  );
}
