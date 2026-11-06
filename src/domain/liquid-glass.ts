export interface LiquidGlassSettings {
  backgroundImage: string | null;
  backgroundBlur: number;
}

export const maxBackgroundLength = 1_400_000;
export const defaultLiquidGlass: LiquidGlassSettings = {
  backgroundImage: null,
  backgroundBlur: 0,
};

export function isBackgroundImage(value: string): boolean {
  const prefix = 'data:image/jpeg;base64,';
  if (value.length > maxBackgroundLength || !value.startsWith(prefix)) return false;
  const encoded = value.slice(prefix.length);
  return (
    encoded.length >= 16 && encoded.length % 4 === 0 && /^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  );
}
