import {
  UNSPECIFIED_SITE_LABEL,
  collectPhotoItems,
  groupPhotosBySite,
  photoSiteKey,
  photoSiteLabel,
} from './photo-sites';

const photoEntry = (metadata: any) => ({ id: 'e1', type: 'photo' as const, metadata });

const observation = (id: string, observedAt: number, entries: any[], recordedByUserId = 'u1'): any => ({
  id,
  patientId: 'p1',
  recordedByUserId,
  observedAt,
  text: null,
  episodeIds: [],
  resolvesEpisodeIds: [],
  entries,
  unitPreferenceAtEntry: null,
  createdAt: observedAt,
  updatedAt: observedAt,
});

describe('photoSiteKey', () => {
  it('groups the same site regardless of casing or padding, and keeps sides apart', () => {
    expect(photoSiteKey(' Ear Drum ', 'left')).toBe(photoSiteKey('ear drum', 'left'));
    expect(photoSiteKey('ear drum', 'left')).not.toBe(photoSiteKey('ear drum', 'right'));
  });
});

describe('photoSiteLabel', () => {
  it('shows the recorded casing and omits a side that says nothing', () => {
    expect(photoSiteLabel('Ear Drum', 'right')).toBe('Ear Drum · right');
    expect(photoSiteLabel('rash on back', 'n/a')).toBe('rash on back');
  });

  it('names a site with no recorded location rather than rendering an empty label', () => {
    expect(photoSiteLabel('', 'n/a')).toBe(UNSPECIFIED_SITE_LABEL);
  });
});

describe('collectPhotoItems', () => {
  it('lifts photo entries out of their observations, oldest first', () => {
    const items = collectPhotoItems([
      observation('o2', 200, [photoEntry({ fileId: 'f2', bodyLocation: 'Ear drum', side: 'left' })]),
      observation('o1', 100, [photoEntry({ fileId: 'f1', bodyLocation: 'Ear drum', side: 'left' })]),
    ]);
    expect(items.map((i) => i.fileId)).toEqual(['f1', 'f2']);
    expect(items[0]).toMatchObject({ observationId: 'o1', timestamp: 100, recordedByUserId: 'u1' });
  });

  it('ignores the non-photo entries a multi-entry observation carries alongside', () => {
    const items = collectPhotoItems([
      observation('o1', 100, [
        { id: 'e0', type: 'temperature', metadata: { value: 38.2, unit: 'C', method: 'oral' } },
        photoEntry({ fileId: 'f1', bodyLocation: 'Ear drum', side: 'left' }),
      ]),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].fileId).toBe('f1');
  });

  it('keeps size and note when present and nulls them when not', () => {
    const [withExtras, without] = collectPhotoItems([
      observation('o1', 100, [photoEntry({ fileId: 'f1', bodyLocation: 'back', side: 'n/a', sizeCm: 2.5, note: 'raised' })]),
      observation('o2', 200, [photoEntry({ fileId: 'f2', bodyLocation: 'back', side: 'n/a' })]),
    ]);
    expect(withExtras).toMatchObject({ sizeCm: 2.5, note: 'raised' });
    expect(without).toMatchObject({ sizeCm: null, note: null });
  });

  it('survives metadata that is missing, malformed or has no location', () => {
    const items = collectPhotoItems([
      observation('o1', 100, [{ id: 'e1', type: 'photo', metadata: null }]),
      observation('o2', 200, [photoEntry({ bodyLocation: 'ear', side: 'left' })]), // no fileId
      observation('o3', 300, [photoEntry({ fileId: 'f3', side: 'sideways' })]),
    ]);
    // Only the entry with a fileId survives; an unrecognized side falls back to n/a.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ fileId: 'f3', bodyLocation: '', side: 'n/a' });
  });

  it('handles a null payload', () => {
    expect(collectPhotoItems(null)).toEqual([]);
  });
});

describe('groupPhotosBySite', () => {
  const items = collectPhotoItems([
    observation('o1', 100, [photoEntry({ fileId: 'f1', bodyLocation: 'Ear drum', side: 'left' })]),
    observation('o2', 200, [photoEntry({ fileId: 'f2', bodyLocation: 'ear DRUM', side: 'left' })]),
    observation('o3', 300, [photoEntry({ fileId: 'f3', bodyLocation: 'Ear drum', side: 'right' })]),
    observation('o4', 400, [photoEntry({ fileId: 'f4', bodyLocation: '  ', side: 'n/a' })]),
  ]);

  it('groups by (bodyLocation, side), case-insensitively on the location', () => {
    const sites = groupPhotosBySite(items);
    expect(sites).toHaveLength(3);
    const left = sites.find((s) => s.side === 'left')!;
    expect(left.count).toBe(2);
    expect(left.photos.map((p) => p.fileId)).toEqual(['f1', 'f2']);
  });

  it('keeps a left and a right site apart', () => {
    const sites = groupPhotosBySite(items);
    expect(sites.filter((s) => s.bodyLocation.toLowerCase() === 'ear drum').map((s) => s.side).sort()).toEqual([
      'left',
      'right',
    ]);
  });

  it('orders sites by the recency of their latest photo, and photos oldest first', () => {
    const sites = groupPhotosBySite(items);
    expect(sites.map((s) => s.latest.fileId)).toEqual(['f4', 'f3', 'f2']);
    expect(sites[2].photos.map((p) => p.timestamp)).toEqual([100, 200]);
  });

  it('labels a group with the casing of its most recent photo', () => {
    const left = groupPhotosBySite(items).find((s) => s.side === 'left')!;
    expect(left.label).toBe('ear DRUM · left');
  });

  it('buckets photos with no recorded location under one unspecified site', () => {
    const unspecified = groupPhotosBySite(items).find((s) => s.label === UNSPECIFIED_SITE_LABEL);
    expect(unspecified).toBeDefined();
    expect(unspecified!.count).toBe(1);
  });
});
