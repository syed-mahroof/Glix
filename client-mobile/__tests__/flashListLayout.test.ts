import { clearFlashListLayoutCacheOnChange } from '../lib/flashListLayout';

describe('clearFlashListLayoutCacheOnChange', () => {
  it('keeps the cache for stable layouts and clears it before a list/grid transition', () => {
    const clearLayoutCacheOnUpdate = jest.fn();
    const ref = { current: { clearLayoutCacheOnUpdate } };

    expect(clearFlashListLayoutCacheOnChange('list', 'list', ref)).toBe('list');
    expect(clearLayoutCacheOnUpdate).not.toHaveBeenCalled();

    expect(clearFlashListLayoutCacheOnChange('list', 'grid', ref)).toBe('grid');
    expect(clearLayoutCacheOnUpdate).toHaveBeenCalledTimes(1);

    expect(clearFlashListLayoutCacheOnChange('grid', 'list', ref)).toBe('list');
    expect(clearLayoutCacheOnUpdate).toHaveBeenCalledTimes(2);
  });

  it('defers updating previousLayout until FlashList ref is attached', () => {
    const clearLayoutCacheOnUpdate = jest.fn();
    const ref: { current: { clearLayoutCacheOnUpdate: () => void } | null } = { current: null };

    // Before mount: ref is null. Function returns previous layout ('list') so transition stays pending.
    expect(clearFlashListLayoutCacheOnChange('list', 'grid', ref)).toBe('list');
    expect(clearLayoutCacheOnUpdate).not.toHaveBeenCalled();

    // After mount: ref attached. Next render sees ('list', 'grid') and successfully clears cache.
    ref.current = { clearLayoutCacheOnUpdate };
    expect(clearFlashListLayoutCacheOnChange('list', 'grid', ref)).toBe('grid');
    expect(clearLayoutCacheOnUpdate).toHaveBeenCalledTimes(1);
  });
});

