import { useState } from 'react';

export const BRAND_LOGO_SRC = '/assets/aistudio/unnamed_a49eff38.png';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  subtitle?: string;
  inverted?: boolean;
  className?: string;
}

const FRAME_SIZES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-8 h-8 rounded-lg p-0.5',
  md: 'w-10 h-10 rounded-xl p-1',
  lg: 'w-14 h-14 rounded-2xl p-1.5',
};

const WORDMARK_SIZES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[15px]',
  md: 'text-base',
  lg: 'text-xl',
};

export function BrandLogo({
  size = 'md',
  showWordmark = false,
  subtitle,
  inverted = false,
  className = '',
}: BrandLogoProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <span className={`inline-flex items-center gap-2.5 min-w-0 ${className}`}>
      <span
        className={`${FRAME_SIZES[size]} bg-white flex items-center justify-center shrink-0 overflow-hidden ${
          inverted
            ? 'ring-1 ring-white/25 shadow-sm'
            : 'ring-1 ring-[#141413]/10 shadow-2xs'
        }`}
      >
        {!imgError ? (
          <img
            src={BRAND_LOGO_SRC}
            alt="Logo JikJikoox"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="font-display font-extrabold text-xs text-[#0E6E2D]">JX</span>
        )}
      </span>

      {showWordmark && (
        <span className="flex flex-col leading-none min-w-0">
          <span
            className={`font-display font-extrabold tracking-tight whitespace-nowrap ${WORDMARK_SIZES[size]} ${
              inverted ? 'text-white' : 'text-[#141413]'
            }`}
          >
            JikJikoox{' '}
            <span className={inverted ? 'text-[#F4A61D]' : 'text-[#0E6E2D]'}>Express</span>
          </span>
          {subtitle && (
            <span
              className={`text-[11px] font-medium mt-1 truncate ${
                inverted ? 'text-white/75' : 'text-[#5A5851]'
              }`}
            >
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

interface BrandAccentBarProps {
  className?: string;
}

/**
 * Signature 4-tone hairline mirroring the left-to-right palette of the JikJikoox leaf emblem:
 * Crimson Red (#C6241B) · Earth/Obsidian (#141413) · Golden Amber (#F4A61D) · Forest Green (#0E6E2D).
 */
export function BrandAccentBar({ className = '' }: BrandAccentBarProps) {
  return (
    <div aria-hidden="true" className={`w-full h-1 flex overflow-hidden ${className}`}>
      <div className="flex-1 bg-[#C6241B]" />
      <div className="flex-[0.65] bg-[#652214]" />
      <div className="flex-[0.65] bg-[#141413]" />
      <div className="flex-1 bg-[#F4A61D]" />
      <div className="flex-[0.7] bg-[#2F9428]" />
      <div className="flex-1 bg-[#0E6E2D]" />
    </div>
  );
}
