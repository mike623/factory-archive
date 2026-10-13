// icons.tsx — technical line-style icon set (stroke-based, 1.6px)
import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'd'> {
  size?: number;
  sw?: number;
}

const I = ({ d, size = 16, sw = 1.6, fill = 'none', children, ...p }: IconProps & { d?: string; children?: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round"
       strokeLinejoin="round" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

export type Icon = (p: IconProps) => ReactNode;

/* ---- nav / chrome ---- */
export const IcLibrary = (p: IconProps) => <I {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></I>;
export const IcInbox = (p: IconProps) => <I {...p}><path d="M3 12l3-7h12l3 7"/><path d="M3 12v6a1 1 0 001 1h16a1 1 0 001-1v-6"/><path d="M3 12h5l1.5 2.5h5L16 12h5"/></I>;
export const IcTag = (p: IconProps) => <I {...p}><path d="M3 11.5V5a2 2 0 012-2h6.5a2 2 0 011.4.6l7.5 7.5a2 2 0 010 2.8l-6.6 6.6a2 2 0 01-2.8 0L3.6 12.9A2 2 0 013 11.5z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></I>;
export const IcStar = (p: IconProps) => <I {...p}><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5z"/></I>;
export const IcSettings = (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/></I>;
export const IcClock = (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></I>;
export const IcFolder = (p: IconProps) => <I {...p}><path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></I>;

/* ---- actions ---- */
export const IcSearch = (p: IconProps) => <I {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></I>;
export const IcPlus = (p: IconProps) => <I {...p}><path d="M12 5v14M5 12h14"/></I>;
export const IcDownload = (p: IconProps) => <I {...p}><path d="M12 3v12M7 11l5 5 5-5"/><path d="M5 20h14"/></I>;
export const IcUpload = (p: IconProps) => <I {...p}><path d="M12 21V9M7 13l5-5 5 5"/><path d="M5 4h14"/></I>;
export const IcExport = (p: IconProps) => <I {...p}><path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/></I>;
export const IcLink = (p: IconProps) => <I {...p}><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7l1.5-1.5"/></I>;
export const IcClose = (p: IconProps) => <I {...p}><path d="M6 6l12 12M18 6L6 18"/></I>;
export const IcCheck = (p: IconProps) => <I {...p}><path d="M5 12.5l4.5 4.5L19 7"/></I>;
export const IcCopy = (p: IconProps) => <I {...p}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/></I>;
export const IcChevron = (p: IconProps) => <I {...p}><path d="M9 6l6 6-6 6"/></I>;
export const IcChevDown = (p: IconProps) => <I {...p}><path d="M6 9l6 6 6-6"/></I>;
export const IcArrowLeft = (p: IconProps) => <I {...p}><path d="M19 12H5M11 18l-6-6 6-6"/></I>;
export const IcExternal = (p: IconProps) => <I {...p}><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/></I>;
export const IcFilter = (p: IconProps) => <I {...p}><path d="M3 5h18M6 12h12M10 19h4"/></I>;
export const IcGrid = (p: IconProps) => <I {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></I>;
export const IcList = (p: IconProps) => <I {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></I>;
export const IcTrash = (p: IconProps) => <I {...p}><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/></I>;
export const IcDots = (p: IconProps) => <I {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></I>;
export const IcInfo = (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></I>;
export const IcRefresh = (p: IconProps) => <I {...p}><path d="M20 11a8 8 0 00-14-4.5L4 8M4 4v4h4"/><path d="M4 13a8 8 0 0014 4.5L20 16M20 20v-4h-4"/></I>;

/* ---- metadata / domain ---- */
export const IcDimensions = (p: IconProps) => <I {...p}><path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/></I>;
export const IcPower = (p: IconProps) => <I {...p}><path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z"/></I>;
export const IcMachine = (p: IconProps) => <I {...p}><rect x="3" y="8" width="18" height="11" rx="1"/><path d="M7 8V5h4v3M7 12h3M14 12h3M14 15h3"/></I>;
export const IcMaterial = (p: IconProps) => <I {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 3v9M12 12l8-4.5M12 12l-8-4.5"/></I>;
export const IcFile = (p: IconProps) => <I {...p}><path d="M6 3h8l4 4v14a0 0 0 010 0H6a0 0 0 010 0V3z" /><path d="M14 3v4h4"/></I>;
export const IcVersion = (p: IconProps) => <I {...p}><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8 6h6a2 2 0 012 2v1.5M15.6 13.6L8.4 17"/></I>;
export const IcUser = (p: IconProps) => <I {...p}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></I>;
export const IcCalendar = (p: IconProps) => <I {...p}><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></I>;
export const IcCube = (p: IconProps) => <I {...p}><path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3L12 2.5z"/><path d="M12 12l8.5-4.7M12 12v9.5M12 12L3.5 7.3"/></I>;
export const IcLayers = (p: IconProps) => <I {...p}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 16.5l9 5 9-5"/></I>;
export const IcWarn = (p: IconProps) => <I {...p}><path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/></I>;
export const IcWrench = (p: IconProps) => <I {...p}><path d="M15 6a4 4 0 00-5.2 5.2L4 17l3 3 5.8-5.8A4 4 0 0018 9l-2.5 2.5L13 9l2.5-2.5A4 4 0 0015 6z"/></I>;
export const IcBolt = (p: IconProps) => <I {...p}><path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z"/></I>;

/* ---- theme ---- */
export const IcSun = (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></I>;
export const IcMoon = (p: IconProps) => <I {...p}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></I>;
export const IcShare = (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="2"/><path d="M8.5 15.5a5 5 0 010-7M15.5 8.5a5 5 0 010 7M5.6 18.4a9 9 0 010-12.8M18.4 5.6a9 9 0 010 12.8"/></I>;
