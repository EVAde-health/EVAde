import logoUrl from '../assets/evade-logo.svg';
import './css/BrandMark.css';

// EVAde orbit-and-pulse logo glyph.
export default function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <img className={`brand-mark brand-mark--${size}`} src={logoUrl} alt="" aria-hidden="true" />;
}
