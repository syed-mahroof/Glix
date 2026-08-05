import { androidGlassColor } from '../components/GlassBlur';

// Independent re-derivation of TintStyle.kt's private toColorInt(), not a
// call into androidGlassColor itself — this is what makes the test able to
// catch a typo'd constant in the production formula instead of just
// agreeing with itself. Kotlin's `.toInt()` on a Double truncates, hence
// Math.trunc here rather than Math.round.
function expectedColor(tint: 'dark' | 'light', intensity: number): string {
  const rgb = tint === 'dark' ? 25 : 249;
  const factor = tint === 'dark' ? 0.69 : 0.78;
  const alpha255 = Math.trunc(255 * (intensity / 100) * factor);
  return `rgba(${rgb},${rgb},${rgb},${alpha255 / 255})`;
}

describe('Android glass color formula (C7)', () => {
  const callSites: Array<{ label: string; intensity: number }> = [
    { label: 'LiquidTabBar.tsx', intensity: 100 },
    { label: 'discover.tsx sticky header', intensity: 80 },
    { label: 'discover.tsx segment control', intensity: 70 },
  ];

  it.each(callSites)('matches an independent re-derivation of the Kotlin formula ($label)', ({ intensity }) => {
    expect(androidGlassColor('dark', intensity)).toBe(expectedColor('dark', intensity));
    expect(androidGlassColor('light', intensity)).toBe(expectedColor('light', intensity));
  });

  // Pixel-identity anchors documented in the component's own header comment
  // — if these ever drift from the comment, the comment is now wrong too.
  it('matches the documented rgba values exactly', () => {
    expect(androidGlassColor('dark', 100)).toBe('rgba(25,25,25,0.6862745098039216)');
    expect(androidGlassColor('light', 100)).toBe('rgba(249,249,249,0.7764705882352941)');
    expect(androidGlassColor('dark', 80)).toBe('rgba(25,25,25,0.5490196078431373)');
    expect(androidGlassColor('light', 80)).toBe('rgba(249,249,249,0.6235294117647059)');
    expect(androidGlassColor('dark', 70)).toBe('rgba(25,25,25,0.4823529411764706)');
    expect(androidGlassColor('light', 70)).toBe('rgba(249,249,249,0.5450980392156862)');
  });
});
